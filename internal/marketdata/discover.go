package marketdata

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// DefaultPageURL is the page whose inline configuration exposes the market
// data API base URL and subscription key.
const DefaultPageURL = "https://www.infomoney.com.br/ferramentas/altas-e-baixas/"

const maxPageBytes = 8 << 20

var apiConfigPattern = regexp.MustCompile(`"api_marketdata":\{[^}]*"base_api_marketdata":"([^"]+)"[^}]*"ocp_apim_subscription_key":"([^"]+)"`)

type pageConfig struct {
	APIMarketData struct {
		BaseURL         string `json:"base_api_marketdata"`
		SubscriptionKey string `json:"ocp_apim_subscription_key"`
	} `json:"api_marketdata"`
}

// Bootstrap holds the runtime configuration needed to call the market data
// API. It is scraped from the page because the subscription key can rotate.
type Bootstrap struct {
	BaseURL string
	APIKey  string
}

// Discover fetches the InfoMoney page and extracts the market data API base URL
// and subscription key from window.InfoMoneyPage.
func Discover(ctx context.Context, client *http.Client, pageURL string) (Bootstrap, error) {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
	if err != nil {
		return Bootstrap{}, fmt.Errorf("build page request: %w", err)
	}
	req.Header.Set("User-Agent", defaultUserAgent)
	req.Header.Set("Accept", "text/html")

	resp, err := client.Do(req)
	if err != nil {
		return Bootstrap{}, fmt.Errorf("fetch page: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return Bootstrap{}, fmt.Errorf("fetch page: unexpected status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxPageBytes))
	if err != nil {
		return Bootstrap{}, fmt.Errorf("read page: %w", err)
	}

	return parsePageConfig(body)
}

func parsePageConfig(body []byte) (Bootstrap, error) {
	const marker = "window.InfoMoneyPage = "

	if idx := bytes.Index(body, []byte(marker)); idx >= 0 {
		decoder := json.NewDecoder(bytes.NewReader(body[idx+len(marker):]))
		var cfg pageConfig
		if err := decoder.Decode(&cfg); err == nil {
			bootstrap := Bootstrap{
				BaseURL: cfg.APIMarketData.BaseURL,
				APIKey:  cfg.APIMarketData.SubscriptionKey,
			}
			if bootstrap.BaseURL != "" && bootstrap.APIKey != "" {
				return bootstrap, nil
			}
		}
	}

	match := apiConfigPattern.FindSubmatch(body)
	if len(match) != 3 { //nolint:mnd // regexp group count is fixed at 3
		return Bootstrap{}, ErrConfigNotFound
	}

	return Bootstrap{
		BaseURL: strings.ReplaceAll(string(match[1]), `\/`, "/"),
		APIKey:  string(match[2]),
	}, nil
}
