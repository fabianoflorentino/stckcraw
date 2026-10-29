package marketindex_test

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/fabianoflorentino/stckcraw/internal/marketindex"
)

func TestClientFetch(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/v8/finance/chart/") {
			t.Errorf("path = %q", r.URL.Path)
		}
		if !strings.Contains(r.URL.Path, "BVSP") {
			t.Errorf("path = %q, want BVSP", r.URL.Path)
		}
		if got := r.URL.Query().Get("range"); got != "1d" {
			t.Errorf("range = %q", got)
		}
		if got := r.URL.Query().Get("interval"); got != "1d" {
			t.Errorf("interval = %q", got)
		}

		w.Header().Set("Content-Type", "application/json")
		if _, err := fmt.Fprint(w, `{"chart":{"result":[{"meta":{
			"symbol":"^BVSP",
			"regularMarketPrice":169081.88,
			"chartPreviousClose":171006.1,
			"regularMarketTime":1793294520,
			"currency":"BRL",
			"exchangeTimezoneName":"America/Sao_Paulo"
		}}],"error":null}}`); err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	defer server.Close()

	client, err := marketindex.NewClient(marketindex.WithBaseURL(server.URL))
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}

	quote, err := client.Fetch(context.Background(), marketindex.Definition{
		Key:    "ibovespa",
		Label:  "Ibovespa",
		Symbol: "^BVSP",
	})
	if err != nil {
		t.Fatalf("Fetch() error = %v", err)
	}

	if quote.Price != 169081.88 {
		t.Errorf("Price = %v", quote.Price)
	}
	expectedChange := (169081.88/171006.1 - 1) * 100
	if math.Abs(quote.Change-expectedChange) > 1e-9 {
		t.Errorf("Change = %v, want %v", quote.Change, expectedChange)
	}
	if quote.Currency != "BRL" || quote.Timezone != "America/Sao_Paulo" {
		t.Errorf("unexpected metadata: %+v", quote)
	}
	if quote.AsOf.Unix() != 1793294520 {
		t.Errorf("AsOf = %v", quote.AsOf)
	}
}

func TestClientFetchAllKeepsFailures(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "BAD") {
			w.WriteHeader(http.StatusNotFound)
			if _, err := fmt.Fprint(w, "not found"); err != nil {
				t.Errorf("write response: %v", err)
			}
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if _, err := fmt.Fprint(w, `{"chart":{"result":[{"meta":{
			"symbol":"^BVSP","regularMarketPrice":100,"chartPreviousClose":90,
			"regularMarketTime":1793294520,"currency":"BRL","exchangeTimezoneName":"America/Sao_Paulo"
		}}],"error":null}}`); err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	defer server.Close()

	client, err := marketindex.NewClient(marketindex.WithBaseURL(server.URL))
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}

	quotes, err := client.FetchAll(context.Background(), []marketindex.Definition{
		{Key: "ok", Label: "OK", Symbol: "^BVSP"},
		{Key: "bad", Label: "Bad", Symbol: "BAD"},
	})
	if err != nil {
		t.Fatalf("FetchAll() error = %v", err)
	}
	if len(quotes) != 2 {
		t.Fatalf("quotes = %d, want 2", len(quotes))
	}
	if quotes[0].Error != "" || quotes[0].Price != 100 {
		t.Errorf("first quote = %+v", quotes[0])
	}
	if quotes[1].Error == "" {
		t.Errorf("second quote should have an error: %+v", quotes[1])
	}
}

func TestClientFetchErrors(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
	}{
		{name: "empty result", body: `{"chart":{"result":[],"error":null}}`},
		{name: "yahoo error", body: `{"chart":{"result":[],"error":{"code":"Not Found","description":"No data found"}}}`},
		{name: "missing price", body: `{"chart":{"result":[{"meta":{"regularMarketPrice":0,"chartPreviousClose":10}}]}}`},
		{name: "missing previous close", body: `{"chart":{"result":[{"meta":{"regularMarketPrice":10,"chartPreviousClose":0}}]}}`},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if _, err := fmt.Fprint(w, test.body); err != nil {
					t.Errorf("write response: %v", err)
				}
			}))
			defer server.Close()

			client, err := marketindex.NewClient(marketindex.WithBaseURL(server.URL))
			if err != nil {
				t.Fatalf("NewClient() error = %v", err)
			}

			if _, err := client.Fetch(context.Background(), marketindex.Definition{Symbol: "^BVSP"}); err == nil {
				t.Fatal("Fetch() error = nil, want error")
			}
		})
	}
}

func TestNewClientValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		opts []marketindex.Option
	}{
		{name: "empty base URL", opts: []marketindex.Option{marketindex.WithBaseURL("")}},
		{name: "invalid scheme", opts: []marketindex.Option{marketindex.WithBaseURL("ftp://example.com")}},
		{name: "nil http client", opts: []marketindex.Option{marketindex.WithHTTPClient(nil)}},
		{name: "empty user agent", opts: []marketindex.Option{marketindex.WithUserAgent(" ")}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			if _, err := marketindex.NewClient(test.opts...); err == nil {
				t.Fatal("NewClient() error = nil, want error")
			}
		})
	}
}

func TestDefaultIndices(t *testing.T) {
	t.Parallel()

	indices := marketindex.DefaultIndices()
	if len(indices) != 4 {
		t.Fatalf("DefaultIndices() returned %d indices, want 4", len(indices))
	}
	for _, index := range indices {
		if index.Key == "" || index.Label == "" || index.Symbol == "" {
			t.Errorf("incomplete index: %+v", index)
		}
	}
}
