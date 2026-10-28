package marketdata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const defaultUserAgent = "stckcraw/1.0 (+https://github.com/fabianoflorentino/stckcraw)"

const (
	defaultPageSize = 100
	defaultMaxPages = 1000
)

// Client fetches leaderboards from the InfoMoney market data API.
type Client struct {
	httpClient *http.Client
	baseURL    string
	apiKey     string
	pageSize   int
	maxPages   int
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

// WithPageSize sets how many quotes are requested per page.
func WithPageSize(size int) Option {
	return func(c *Client) error {
		if size <= 0 {
			return fmt.Errorf("page size must be positive, got %d", size)
		}
		c.pageSize = size
		return nil
	}
}

// WithMaxPages caps how many pages a single variant may fetch.
func WithMaxPages(pages int) Option {
	return func(c *Client) error {
		if pages <= 0 {
			return fmt.Errorf("max pages must be positive, got %d", pages)
		}
		c.maxPages = pages
		return nil
	}
}

// WithUserAgent overrides the User-Agent header sent to the API.
func WithUserAgent(userAgent string) Option {
	return func(c *Client) error {
		if strings.TrimSpace(userAgent) == "" {
			return errors.New("user agent must not be empty")
		}
		c.userAgent = userAgent
		return nil
	}
}

// NewClient builds a client for the given API base URL and subscription key.
func NewClient(baseURL, apiKey string, opts ...Option) (*Client, error) {
	if strings.TrimSpace(baseURL) == "" {
		return nil, errors.New("base URL is required")
	}
	if strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("API key is required")
	}

	parsed, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("parse base URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("base URL scheme must be http or https, got %q", parsed.Scheme)
	}
	if parsed.Host == "" {
		return nil, errors.New("base URL must include a host")
	}

	client := &Client{
		httpClient: &http.Client{Timeout: 30 * time.Second},
		baseURL:    strings.TrimRight(baseURL, "/") + "/",
		apiKey:     apiKey,
		pageSize:   defaultPageSize,
		maxPages:   defaultMaxPages,
		userAgent:  defaultUserAgent,
	}

	for _, opt := range opts {
		if err := opt(client); err != nil {
			return nil, fmt.Errorf("configure client: %w", err)
		}
	}

	return client, nil
}

// Fetch retrieves every page of the leaderboard for the variant.
func (c *Client) Fetch(ctx context.Context, variant Variant) ([]Quote, error) {
	if _, err := c.endpoint(variant); err != nil {
		return nil, err
	}

	quotes := make([]Quote, 0, c.pageSize)

	for page := 1; ; page++ {
		if err := ctx.Err(); err != nil {
			return quotes, err
		}
		if page > c.maxPages {
			return quotes, fmt.Errorf("%s: exceeded max pages (%d)", variant.Slug(), c.maxPages)
		}

		response, err := c.fetchPage(ctx, variant, page)
		if err != nil {
			return quotes, fmt.Errorf("%s page %d: %w", variant.Slug(), page, err)
		}

		for _, dto := range response.Result {
			quotes = append(quotes, dto.toQuote())
		}

		if !response.hasNextPage(page, c.pageSize) {
			break
		}
	}

	return quotes, nil
}

func (c *Client) fetchPage(ctx context.Context, variant Variant, page int) (leaderboardResponse, error) {
	endpoint, err := c.endpoint(variant)
	if err != nil {
		return leaderboardResponse{}, err
	}

	query := url.Values{}
	query.Set("Property", "Change")
	query.Set("Order", "Desc")
	query.Set("Page", strconv.Itoa(page))
	query.Set("PageSize", strconv.Itoa(c.pageSize))

	if variant.IsB3() {
		if variant.SecurityType != SecurityAll {
			query.Set("SecurityType", string(variant.SecurityType))
		}
		if variant.Index != IndexAll {
			query.Set("Index", string(variant.Index))
		}
	}

	target := endpoint + "?" + query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return leaderboardResponse{}, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Ocp-Apim-Subscription-Key", c.apiKey)
	req.Header.Set("User-Agent", c.userAgent)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return leaderboardResponse{}, fmt.Errorf("do request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNoContent:
		return leaderboardResponse{}, nil
	case http.StatusForbidden:
		return leaderboardResponse{}, ErrAccessBlocked
	default:
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		if readErr != nil {
			return leaderboardResponse{}, fmt.Errorf("unexpected status %d (read body: %w)", resp.StatusCode, readErr)
		}
		return leaderboardResponse{}, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var response leaderboardResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return leaderboardResponse{}, fmt.Errorf("decode response: %w", err)
	}

	return response, nil
}

func (c *Client) endpoint(variant Variant) (string, error) {
	switch variant.Market {
	case MarketB3:
		return c.baseURL + "b3/quotes/intraday/leaderboard", nil
	case MarketNasdaq:
		return c.baseURL + "nasdaq/quote/intraday/leaderboard", nil
	case MarketNYSE:
		return c.baseURL + "nyse/quote/intraday/leaderboard", nil
	default:
		return "", fmt.Errorf("unsupported market %q", variant.Market)
	}
}
