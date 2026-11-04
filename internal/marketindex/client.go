// Package marketindex fetches major market index quotes and daily B3 asset
// histories from the public Yahoo Finance endpoints.
package marketindex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

// DefaultBaseURL is the Yahoo Finance chart API base URL.
const DefaultBaseURL = "https://query1.finance.yahoo.com"

const (
	defaultUserAgent = "stckcraw/1.0 (+https://github.com/fabianoflorentino/stckcraw)"
	historyBatchSize = 20
)

// Definition describes one index shown on the dashboard.
type Definition struct {
	Key    string
	Label  string
	Symbol string
}

// HistoryPoint is one daily close used by the index chart.
type HistoryPoint struct {
	Date  time.Time `json:"date"`
	Close float64   `json:"close"`
}

// Quote is one normalized index quote. History holds the last month of daily
// closes, oldest first, and is omitted when Yahoo returns no series.
type Quote struct {
	Key      string         `json:"key"`
	Label    string         `json:"label"`
	Symbol   string         `json:"symbol"`
	Price    float64        `json:"price"`
	Change   float64        `json:"change"`
	Currency string         `json:"currency,omitempty"`
	Timezone string         `json:"timezone,omitempty"`
	AsOf     time.Time      `json:"asOf"`
	History  []HistoryPoint `json:"history,omitempty"`
	Error    string         `json:"error,omitempty"`
}

// DefaultIndices returns the market overview shown above the B3 tables.
func DefaultIndices() []Definition {
	return []Definition{
		{Key: "ibovespa", Label: "Ibovespa", Symbol: "^BVSP"},
		{Key: "sp500", Label: "S&P 500", Symbol: "^GSPC"},
		{Key: "stoxx50", Label: "Euro Stoxx 50", Symbol: "^STOXX50E"},
		{Key: "shanghai", Label: "Shanghai", Symbol: "000001.SS"},
	}
}

// Client fetches index quotes from Yahoo Finance.
type Client struct {
	httpClient *http.Client
	baseURL    string
	userAgent  string
	fallback   map[string]Quote
}

// Option configures a Client.
type Option func(*Client) error

// WithHTTPClient overrides the HTTP client used for API requests.
func WithHTTPClient(client *http.Client) Option {
	return func(c *Client) error {
		if client == nil {
			return errors.New("http client must not be nil")
		}
		c.httpClient = client
		return nil
	}
}

// WithBaseURL overrides the Yahoo Finance base URL.
func WithBaseURL(baseURL string) Option {
	return func(c *Client) error {
		c.baseURL = baseURL
		return nil
	}
}

// WithFallback keeps the last known-good quotes, used when Yahoo rate-limits
// or fails for one of the indices.
func WithFallback(quotes []Quote) Option {
	return func(c *Client) error {
		c.fallback = make(map[string]Quote, len(quotes))
		for _, quote := range quotes {
			if quote.Key != "" && quote.Error == "" {
				c.fallback[quote.Key] = quote
			}
		}
		return nil
	}
}

// WithUserAgent overrides the User-Agent header.
func WithUserAgent(userAgent string) Option {
	return func(c *Client) error {
		if strings.TrimSpace(userAgent) == "" {
			return errors.New("user agent must not be empty")
		}
		c.userAgent = userAgent
		return nil
	}
}

// NewClient builds a Yahoo Finance index client.
func NewClient(opts ...Option) (*Client, error) {
	client := &Client{
		httpClient: &http.Client{Timeout: 30 * time.Second},
		baseURL:    DefaultBaseURL,
		userAgent:  defaultUserAgent,
	}

	for _, opt := range opts {
		if err := opt(client); err != nil {
			return nil, fmt.Errorf("configure market index client: %w", err)
		}
	}

	if err := validateBaseURL(client.baseURL); err != nil {
		return nil, err
	}
	client.baseURL = strings.TrimRight(client.baseURL, "/")

	return client, nil
}

// FetchAll fetches every definition. Individual failures are returned as
// quotes with Error set; the returned error is reserved for context cancellation.
func (c *Client) FetchAll(ctx context.Context, definitions []Definition) ([]Quote, error) {
	quotes := make([]Quote, 0, len(definitions))

	for _, definition := range definitions {
		if err := ctx.Err(); err != nil {
			return quotes, err
		}

		quote, err := c.Fetch(ctx, definition)
		if err != nil {
			if ctx.Err() != nil {
				return quotes, ctx.Err()
			}
			if cached, ok := c.fallback[definition.Key]; ok {
				quotes = append(quotes, cached)
				continue
			}
			quotes = append(quotes, Quote{
				Key:    definition.Key,
				Label:  definition.Label,
				Symbol: definition.Symbol,
				Error:  err.Error(),
			})
			continue
		}

		quotes = append(quotes, quote)
	}

	return quotes, nil
}

// Fetch fetches one index quote.
func (c *Client) Fetch(ctx context.Context, definition Definition) (Quote, error) {
	if strings.TrimSpace(definition.Symbol) == "" {
		return Quote{}, errors.New("symbol is required")
	}

	target := c.baseURL + "/v8/finance/chart/" + url.PathEscape(definition.Symbol) + "?range=1mo&interval=1d"

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return Quote{}, fmt.Errorf("build request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", c.userAgent)

	response, err := c.httpClient.Do(request)
	if err != nil {
		return Quote{}, fmt.Errorf("do request: %w", err)
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != http.StatusOK {
		body, readErr := io.ReadAll(io.LimitReader(response.Body, 4<<10))
		if readErr != nil {
			return Quote{}, fmt.Errorf("unexpected status %d (read body: %w)", response.StatusCode, readErr)
		}
		return Quote{}, fmt.Errorf("unexpected status %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload chartResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return Quote{}, fmt.Errorf("decode response: %w", err)
	}

	if payload.Chart.Error != nil {
		return Quote{}, fmt.Errorf("yahoo: %s: %s", payload.Chart.Error.Code, payload.Chart.Error.Description)
	}
	if len(payload.Chart.Result) == 0 {
		return Quote{}, errors.New("empty chart result")
	}

	result := payload.Chart.Result[0]
	meta := result.Meta
	if meta.RegularMarketPrice <= 0 {
		return Quote{}, errors.New("missing regular market price")
	}

	asOf := time.Time{}
	if meta.RegularMarketTime > 0 {
		asOf = time.Unix(meta.RegularMarketTime, 0).UTC()
	}

	symbol := meta.Symbol
	if symbol == "" {
		symbol = definition.Symbol
	}

	history := historyFromResult(result)
	change := 0.0
	if meta.RegularMarketChangePercent != nil {
		change = *meta.RegularMarketChangePercent
	} else if len(history) >= 2 {
		previous := history[len(history)-2].Close
		if previous > 0 {
			change = (history[len(history)-1].Close/previous - 1) * 100
		}
	}

	return Quote{
		Key:      definition.Key,
		Label:    definition.Label,
		Symbol:   symbol,
		Price:    meta.RegularMarketPrice,
		Change:   change,
		Currency: meta.Currency,
		Timezone: meta.ExchangeTimezoneName,
		AsOf:     asOf,
		History:  history,
	}, nil
}

func historyFromResult(result chartResult) []HistoryPoint {
	if len(result.Indicators.Quote) == 0 {
		return nil
	}
	return historyFromSeries(result.Timestamp, result.Indicators.Quote[0].Close)
}

func historyFromSeries(timestamps []int64, closes []*float64) []HistoryPoint {
	if len(timestamps) == 0 || len(closes) == 0 {
		return nil
	}

	points := make([]HistoryPoint, 0, min(len(timestamps), len(closes)))
	for i := range min(len(timestamps), len(closes)) {
		value := closes[i]
		if value == nil || *value <= 0 || timestamps[i] <= 0 {
			continue
		}
		points = append(points, HistoryPoint{
			Date:  time.Unix(timestamps[i], 0).UTC(),
			Close: *value,
		})
	}

	if len(points) == 0 {
		return nil
	}
	return points
}

// FetchHistories fetches one month of daily closes for B3 symbols. Symbols are
// plain B3 tickers; Yahoo uses the .SA suffix. Requests are sent in batches of
// at most 20 symbols. Successful batches remain in the returned map when
// another batch fails, and the returned error joins the batch failures.
func (c *Client) FetchHistories(ctx context.Context, symbols []string) (map[string][]HistoryPoint, error) {
	histories := make(map[string][]HistoryPoint, len(symbols))
	pairs := historySymbols(symbols)

	var failures []error
	for start := 0; start < len(pairs); start += historyBatchSize {
		if err := ctx.Err(); err != nil {
			return histories, err
		}

		end := min(start+historyBatchSize, len(pairs))
		batch, err := c.fetchHistoryBatch(ctx, pairs[start:end])
		if err != nil {
			if ctx.Err() != nil {
				return histories, ctx.Err()
			}
			failures = append(failures, err)
			continue
		}
		for symbol, points := range batch {
			histories[symbol] = points
		}
	}

	if len(failures) > 0 {
		return histories, errors.Join(failures...)
	}
	return histories, nil
}

type symbolPair struct {
	original string
	yahoo    string
}

func historySymbols(symbols []string) []symbolPair {
	pairs := make([]symbolPair, 0, len(symbols))
	seen := make(map[string]struct{}, len(symbols))

	for _, raw := range symbols {
		original := strings.ToUpper(strings.TrimSpace(raw))
		if original == "" {
			continue
		}
		if _, ok := seen[original]; ok {
			continue
		}
		seen[original] = struct{}{}

		yahoo := original
		if !strings.HasSuffix(yahoo, ".SA") {
			yahoo += ".SA"
		}
		pairs = append(pairs, symbolPair{original: original, yahoo: yahoo})
	}

	slices.SortFunc(pairs, func(a, b symbolPair) int {
		return strings.Compare(a.yahoo, b.yahoo)
	})
	return pairs
}

func (c *Client) fetchHistoryBatch(ctx context.Context, batch []symbolPair) (map[string][]HistoryPoint, error) {
	query := url.Values{}
	yahooSymbols := make([]string, len(batch))
	originals := make(map[string]string, len(batch))
	for i, pair := range batch {
		yahooSymbols[i] = pair.yahoo
		originals[pair.yahoo] = pair.original
	}
	query.Set("symbols", strings.Join(yahooSymbols, ","))
	query.Set("range", "1mo")
	query.Set("interval", "1d")

	target := c.baseURL + "/v7/finance/spark?" + query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, fmt.Errorf("build history request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", c.userAgent)

	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("do history request: %w", err)
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != http.StatusOK {
		body, readErr := io.ReadAll(io.LimitReader(response.Body, 4<<10))
		if readErr != nil {
			return nil, fmt.Errorf("history status %d (read body: %w)", response.StatusCode, readErr)
		}
		return nil, fmt.Errorf("history status %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload sparkResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode history response: %w", err)
	}

	histories := make(map[string][]HistoryPoint, len(batch))
	for _, result := range payload.Spark.Result {
		original, ok := originals[strings.ToUpper(result.Symbol)]
		if !ok || len(result.Response) == 0 || len(result.Response[0].Indicators.Quote) == 0 {
			continue
		}
		series := result.Response[0]
		points := historyFromSeries(series.Timestamp, series.Indicators.Quote[0].Close)
		if len(points) > 0 {
			histories[original] = points
		}
	}

	return histories, nil
}

// FetchSnapshotIndices reads the indices from a normalized latest.json snapshot.
func FetchSnapshotIndices(ctx context.Context, client *http.Client, snapshotURL string) ([]Quote, error) {
	if strings.TrimSpace(snapshotURL) == "" {
		return nil, errors.New("snapshot URL is required")
	}
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, snapshotURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build snapshot request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", defaultUserAgent)

	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("do snapshot request: %w", err)
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("snapshot status %d", response.StatusCode)
	}

	var payload struct {
		Indices []Quote `json:"indices"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode snapshot: %w", err)
	}

	return payload.Indices, nil
}

type chartResponse struct {
	Chart struct {
		Result []chartResult `json:"result"`
		Error  *chartError   `json:"error"`
	} `json:"chart"`
}

type chartResult struct {
	Meta struct {
		Symbol                     string   `json:"symbol"`
		RegularMarketPrice         float64  `json:"regularMarketPrice"`
		RegularMarketChangePercent *float64 `json:"regularMarketChangePercent"`
		RegularMarketTime          int64    `json:"regularMarketTime"`
		Currency                   string   `json:"currency"`
		ExchangeTimezoneName       string   `json:"exchangeTimezoneName"`
	} `json:"meta"`
	Timestamp  []int64 `json:"timestamp"`
	Indicators struct {
		Quote []struct {
			Close []*float64 `json:"close"`
		} `json:"quote"`
	} `json:"indicators"`
}

type chartError struct {
	Code        string `json:"code"`
	Description string `json:"description"`
}

func validateBaseURL(raw string) error {
	if strings.TrimSpace(raw) == "" {
		return errors.New("base URL is required")
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("parse base URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("base URL scheme must be http or https, got %q", parsed.Scheme)
	}
	if parsed.Host == "" {
		return errors.New("base URL must include a host")
	}

	return nil
}

type sparkResponse struct {
	Spark struct {
		Result []struct {
			Symbol   string `json:"symbol"`
			Response []struct {
				Timestamp  []int64 `json:"timestamp"`
				Indicators struct {
					Quote []struct {
						Close []*float64 `json:"close"`
					} `json:"quote"`
				} `json:"indicators"`
			} `json:"response"`
		} `json:"result"`
	} `json:"spark"`
}
