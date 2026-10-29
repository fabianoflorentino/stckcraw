// Package marketindex fetches major market index quotes from the public Yahoo
// Finance chart endpoint.
package marketindex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultBaseURL is the Yahoo Finance chart API base URL.
const DefaultBaseURL = "https://query1.finance.yahoo.com"

const defaultUserAgent = "stckcraw/1.0 (+https://github.com/fabianoflorentino/stckcraw)"

// Definition describes one index shown on the dashboard.
type Definition struct {
	Key    string
	Label  string
	Symbol string
}

// Quote is one normalized index quote.
type Quote struct {
	Key      string    `json:"key"`
	Label    string    `json:"label"`
	Symbol   string    `json:"symbol"`
	Price    float64   `json:"price"`
	Change   float64   `json:"change"`
	Currency string    `json:"currency,omitempty"`
	Timezone string    `json:"timezone,omitempty"`
	AsOf     time.Time `json:"asOf"`
	Error    string    `json:"error,omitempty"`
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

	target := c.baseURL + "/v8/finance/chart/" + url.PathEscape(definition.Symbol) + "?range=1d&interval=1d"

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

	meta := payload.Chart.Result[0].Meta
	if meta.RegularMarketPrice <= 0 {
		return Quote{}, errors.New("missing regular market price")
	}
	if meta.ChartPreviousClose <= 0 {
		return Quote{}, errors.New("missing previous close")
	}

	asOf := time.Time{}
	if meta.RegularMarketTime > 0 {
		asOf = time.Unix(meta.RegularMarketTime, 0).UTC()
	}

	symbol := meta.Symbol
	if symbol == "" {
		symbol = definition.Symbol
	}

	return Quote{
		Key:      definition.Key,
		Label:    definition.Label,
		Symbol:   symbol,
		Price:    meta.RegularMarketPrice,
		Change:   (meta.RegularMarketPrice/meta.ChartPreviousClose - 1) * 100,
		Currency: meta.Currency,
		Timezone: meta.ExchangeTimezoneName,
		AsOf:     asOf,
	}, nil
}

type chartResponse struct {
	Chart struct {
		Result []struct {
			Meta struct {
				Symbol               string  `json:"symbol"`
				RegularMarketPrice   float64 `json:"regularMarketPrice"`
				ChartPreviousClose   float64 `json:"chartPreviousClose"`
				RegularMarketTime    int64   `json:"regularMarketTime"`
				Currency             string  `json:"currency"`
				ExchangeTimezoneName string  `json:"exchangeTimezoneName"`
			} `json:"meta"`
		} `json:"result"`
		Error *chartError `json:"error"`
	} `json:"chart"`
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
