// Package brapi provides a minimal client for the public brapi.dev quote list
// API, used to build the half-hourly dashboard.
package brapi

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

// DefaultBaseURL is the public brapi.dev API base URL.
const DefaultBaseURL = "https://brapi.dev/api"

const defaultUserAgent = "stckcraw/1.0 (+https://github.com/fabianoflorentino/stckcraw)"

// ListRequest describes one /quote/list query.
type ListRequest struct {
	Type      string
	SubType   string
	Limit     int
	SortOrder string
}

// Asset is one row returned by /quote/list.
type Asset struct {
	Symbol    string   `json:"stock"`
	Name      string   `json:"name"`
	Close     float64  `json:"close"`
	Change    float64  `json:"change"`
	Volume    float64  `json:"volume"`
	MarketCap *float64 `json:"market_cap"`
	Sector    string   `json:"sector"`
	Type      string   `json:"type"`
	SubType   string   `json:"subType"`
}

// Client calls the brapi.dev API.
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

// WithBaseURL overrides the API base URL.
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

// NewClient builds a client for the brapi.dev API.
func NewClient(opts ...Option) (*Client, error) {
	client := &Client{
		httpClient: &http.Client{Timeout: 30 * time.Second},
		baseURL:    DefaultBaseURL,
		userAgent:  defaultUserAgent,
	}

	for _, opt := range opts {
		if err := opt(client); err != nil {
			return nil, fmt.Errorf("configure brapi client: %w", err)
		}
	}

	if err := validateBaseURL(client.baseURL); err != nil {
		return nil, err
	}
	client.baseURL = strings.TrimRight(client.baseURL, "/")

	return client, nil
}

// Top returns assets ordered by daily change, descending.
func (c *Client) Top(ctx context.Context, req ListRequest) ([]Asset, error) {
	if strings.TrimSpace(req.Type) == "" {
		return nil, errors.New("type is required")
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 10
	}

	sortOrder := req.SortOrder
	if sortOrder == "" {
		sortOrder = "desc"
	}
	if sortOrder != "asc" && sortOrder != "desc" {
		return nil, fmt.Errorf("invalid sort order %q: want asc or desc", sortOrder)
	}

	query := url.Values{}
	query.Set("sortBy", "change")
	query.Set("sortOrder", sortOrder)
	query.Set("limit", strconv.Itoa(limit))
	query.Set("type", req.Type)
	if req.SubType != "" {
		query.Set("subType", req.SubType)
	}

	target := c.baseURL + "/quote/list?" + query.Encode()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", c.userAgent)

	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("do request: %w", err)
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != http.StatusOK {
		body, readErr := io.ReadAll(io.LimitReader(response.Body, 4<<10))
		if readErr != nil {
			return nil, fmt.Errorf("unexpected status %d (read body: %w)", response.StatusCode, readErr)
		}
		return nil, fmt.Errorf("unexpected status %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload listResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return payload.Stocks, nil
}

type listResponse struct {
	Stocks []Asset `json:"stocks"`
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
