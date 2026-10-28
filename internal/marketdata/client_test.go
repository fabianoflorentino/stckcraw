package marketdata_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/fabianoflorentino/stckcraw/internal/marketdata"
)

func TestClientFetchPaginatesB3(t *testing.T) {
	t.Parallel()

	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/b3/quotes/intraday/leaderboard" {
			t.Errorf("path = %q", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if got := r.Header.Get("Ocp-Apim-Subscription-Key"); got != "test-key" {
			t.Errorf("subscription key = %q", got)
		}
		if got := r.URL.Query().Get("SecurityType"); got != "Quote" {
			t.Errorf("SecurityType = %q", got)
		}
		if got := r.URL.Query().Get("PageSize"); got != "2" {
			t.Errorf("PageSize = %q", got)
		}

		requests++
		w.Header().Set("Content-Type", "application/json")

		switch r.URL.Query().Get("Page") {
		case "1":
			writeJSON(t, w, `{"result":[
				{"symbol":"PETR4","tradeDate":"2026-10-28T15:00:00-03:00","price":38.5,"change":1.25,"changeMonth":2.5,"changeYear":3.75,"change52w":4.0,"low":37.9,"high":38.9,"financialVolume":123456789},
				{"symbol":"VALE3","price":61.2}
			],"pageInfo":{"hasNextPage":true}}`)
		case "2":
			writeJSON(t, w, `{"result":[{"symbol":"ITUB4","price":33.1}],"pageInfo":{"hasNextPage":false}}`)
		default:
			t.Errorf("unexpected page %q", r.URL.Query().Get("Page"))
		}
	}))
	defer server.Close()

	client, err := marketdata.NewClient(server.URL, "test-key", marketdata.WithPageSize(2))
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}

	quotes, err := client.Fetch(context.Background(), marketdata.Variant{
		Market:       marketdata.MarketB3,
		SecurityType: marketdata.SecurityStock,
	})
	if err != nil {
		t.Fatalf("Fetch() error = %v", err)
	}
	if len(quotes) != 3 {
		t.Fatalf("Fetch() returned %d quotes, want 3", len(quotes))
	}
	if requests != 2 {
		t.Errorf("requests = %d, want 2", requests)
	}
	if quotes[0].Symbol != "PETR4" || quotes[0].Price == nil || *quotes[0].Price != 38.5 {
		t.Errorf("unexpected first quote: %+v", quotes[0])
	}
	if quotes[0].FinancialVolume == nil || *quotes[0].FinancialVolume != 123456789 {
		t.Errorf("unexpected financial volume: %+v", quotes[0].FinancialVolume)
	}
	if quotes[2].Symbol != "ITUB4" {
		t.Errorf("unexpected last quote: %+v", quotes[2])
	}
}

func TestClientFetchNasdaqUsesTicker(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/nasdaq/quote/intraday/leaderboard" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.URL.Query().Get("SecurityType") != "" || r.URL.Query().Get("Index") != "" {
			t.Errorf("US request should not carry B3 filters: %s", r.URL.RawQuery)
		}
		writeJSON(t, w, `{"result":[{"ticker":"AAPL","price":230.1}],"pageInfo":{"hasNextPage":false}}`)
	}))
	defer server.Close()

	client, err := marketdata.NewClient(server.URL, "test-key")
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}

	quotes, err := client.Fetch(context.Background(), marketdata.Variant{Market: marketdata.MarketNasdaq})
	if err != nil {
		t.Fatalf("Fetch() error = %v", err)
	}
	if len(quotes) != 1 || quotes[0].Symbol != "AAPL" {
		t.Fatalf("quotes = %+v", quotes)
	}
}

func TestClientFetchBlocked(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, "Acesso Bloqueado")
	}))
	defer server.Close()

	client, err := marketdata.NewClient(server.URL, "test-key")
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}

	_, err = client.Fetch(context.Background(), marketdata.Variant{Market: marketdata.MarketB3})
	if !errors.Is(err, marketdata.ErrAccessBlocked) {
		t.Fatalf("Fetch() error = %v, want ErrAccessBlocked", err)
	}
}

func TestNewClientValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		baseURL string
		apiKey  string
		opts    []marketdata.Option
	}{
		{name: "empty base URL", baseURL: "", apiKey: "key"},
		{name: "empty API key", baseURL: "https://api.example.com", apiKey: ""},
		{name: "invalid scheme", baseURL: "ftp://api.example.com", apiKey: "key"},
		{name: "invalid page size", baseURL: "https://api.example.com", apiKey: "key", opts: []marketdata.Option{marketdata.WithPageSize(0)}},
		{name: "invalid concurrency", baseURL: "https://api.example.com", apiKey: "key", opts: []marketdata.Option{marketdata.WithMaxPages(-1)}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			if _, err := marketdata.NewClient(test.baseURL, test.apiKey, test.opts...); err == nil {
				t.Fatal("NewClient() error = nil, want error")
			}
		})
	}
}

func TestClientEndpointRejectsUnknownMarket(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, `{"result":[]}`)
	}))
	defer server.Close()

	client, err := marketdata.NewClient(server.URL, "test-key")
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}

	_, err = client.Fetch(context.Background(), marketdata.Variant{Market: "crypto"})
	if err == nil {
		t.Fatal("Fetch() error = nil, want error")
	}
}

func writeJSON(t *testing.T, w http.ResponseWriter, body string) {
	t.Helper()

	w.Header().Set("Content-Type", "application/json")
	if _, err := fmt.Fprint(w, body); err != nil {
		t.Errorf("write response: %v", err)
	}
}
