package marketindex_test

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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
		if got := r.URL.Query().Get("range"); got != "1mo" {
			t.Errorf("range = %q", got)
		}
		if got := r.URL.Query().Get("interval"); got != "1d" {
			t.Errorf("interval = %q", got)
		}

		w.Header().Set("Content-Type", "application/json")
		if _, err := fmt.Fprint(w, `{"chart":{"result":[{
			"meta":{
				"symbol":"^BVSP",
				"regularMarketPrice":169081.88,
				"regularMarketChangePercent":-1.125,
				"regularMarketTime":1793294520,
				"currency":"BRL",
				"exchangeTimezoneName":"America/Sao_Paulo"
			},
			"timestamp":[1793208120,1793294520],
			"indicators":{"quote":[{"close":[171006.1,169081.88]}]}
		}],"error":null}}`); err != nil {
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
	if math.Abs(quote.Change-(-1.125)) > 1e-9 {
		t.Errorf("Change = %v, want -1.125", quote.Change)
	}
	if quote.Currency != "BRL" || quote.Timezone != "America/Sao_Paulo" {
		t.Errorf("unexpected metadata: %+v", quote)
	}
	if quote.AsOf.Unix() != 1793294520 {
		t.Errorf("AsOf = %v", quote.AsOf)
	}
	if len(quote.History) != 2 {
		t.Fatalf("History = %+v, want 2 points", quote.History)
	}
	if quote.History[0].Close != 171006.1 || quote.History[1].Close != 169081.88 {
		t.Errorf("History = %+v", quote.History)
	}
	if quote.History[1].Date.Unix() != 1793294520 {
		t.Errorf("History last date = %v", quote.History[1].Date)
	}
}

func TestClientFetchHistorySkipsEmptyCloses(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if _, err := fmt.Fprint(w, `{"chart":{"result":[{
			"meta":{
				"symbol":"^BVSP",
				"regularMarketPrice":102,
				"regularMarketTime":1793294520,
				"currency":"BRL",
				"exchangeTimezoneName":"America/Sao_Paulo"
			},
			"timestamp":[1793000000,1793100000,1793200000],
			"indicators":{"quote":[{"close":[100,null,102]}]}
		}],"error":null}}`); err != nil {
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

	if len(quote.History) != 2 {
		t.Fatalf("History = %+v, want 2 points", quote.History)
	}
	if quote.History[0].Close != 100 || quote.History[1].Close != 102 {
		t.Errorf("History = %+v", quote.History)
	}
	if math.Abs(quote.Change-2) > 1e-9 {
		t.Errorf("Change = %v, want 2", quote.Change)
	}
}

func TestClientFetchHistoriesBatches(t *testing.T) {
	t.Parallel()

	var (
		mu      sync.Mutex
		batches [][]string
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v7/finance/spark" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if got := r.URL.Query().Get("range"); got != "1mo" {
			t.Errorf("range = %q", got)
		}
		if got := r.URL.Query().Get("interval"); got != "1d" {
			t.Errorf("interval = %q", got)
		}

		symbols := strings.Split(r.URL.Query().Get("symbols"), ",")
		mu.Lock()
		batches = append(batches, symbols)
		mu.Unlock()

		results := make([]map[string]any, 0, len(symbols))
		for _, symbol := range symbols {
			results = append(results, map[string]any{
				"symbol": symbol,
				"response": []any{map[string]any{
					"timestamp": []int64{1793208120, 1793294520},
					"indicators": map[string]any{
						"quote": []any{map[string]any{"close": []any{100, 101}}},
					},
				}},
			})
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{
			"spark": map[string]any{"result": results},
		}); err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	defer server.Close()

	client, err := marketindex.NewClient(marketindex.WithBaseURL(server.URL))
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}

	symbols := make([]string, 45)
	for i := range symbols {
		symbols[i] = fmt.Sprintf("AAA%02d", i)
	}

	histories, err := client.FetchHistories(context.Background(), symbols)
	if err != nil {
		t.Fatalf("FetchHistories() error = %v", err)
	}
	if len(histories) != 45 {
		t.Fatalf("histories = %d, want 45", len(histories))
	}
	if points := histories["AAA00"]; len(points) != 2 || points[1].Close != 101 {
		t.Errorf("AAA00 history = %+v", points)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(batches) != 3 {
		t.Fatalf("batches = %d, want 3", len(batches))
	}
	for i, batch := range batches {
		if len(batch) > 20 {
			t.Errorf("batch %d has %d symbols, want at most 20", i, len(batch))
		}
	}
	if len(batches[0]) != 20 || len(batches[1]) != 20 || len(batches[2]) != 5 {
		t.Errorf("batch sizes = %d/%d/%d, want 20/20/5", len(batches[0]), len(batches[1]), len(batches[2]))
	}
	if got := batches[0][0]; got != "AAA00.SA" {
		t.Errorf("first Yahoo symbol = %q, want AAA00.SA", got)
	}
}

func TestClientFetchHistoriesKeepsSuccessfulBatches(t *testing.T) {
	t.Parallel()

	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if requests == 1 {
			w.WriteHeader(http.StatusBadGateway)
			if _, err := fmt.Fprint(w, "upstream down"); err != nil {
				t.Errorf("write response: %v", err)
			}
			return
		}

		symbols := strings.Split(r.URL.Query().Get("symbols"), ",")
		results := make([]map[string]any, 0, len(symbols))
		for _, symbol := range symbols {
			results = append(results, map[string]any{
				"symbol": symbol,
				"response": []any{map[string]any{
					"timestamp": []int64{1793208120, 1793294520},
					"indicators": map[string]any{
						"quote": []any{map[string]any{"close": []any{100, 101}}},
					},
				}},
			})
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{
			"spark": map[string]any{"result": results},
		}); err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	defer server.Close()

	client, err := marketindex.NewClient(marketindex.WithBaseURL(server.URL))
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}

	symbols := make([]string, 25)
	for i := range symbols {
		symbols[i] = fmt.Sprintf("BBB%02d", i)
	}

	histories, err := client.FetchHistories(context.Background(), symbols)
	if err == nil {
		t.Fatal("FetchHistories() error = nil, want batch failure")
	}
	if len(histories) != 5 {
		t.Errorf("histories = %d, want 5 from the successful batch", len(histories))
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
		{name: "missing price", body: `{"chart":{"result":[{"meta":{"regularMarketPrice":0}}]}}`},
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

func TestClientFetchAllUsesFallback(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		if _, err := fmt.Fprint(w, "rate limited"); err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	defer server.Close()

	fallback := []marketindex.Quote{
		{Key: "ibovespa", Label: "Ibovespa", Symbol: "^BVSP", Price: 169000, Change: -1.5},
	}

	client, err := marketindex.NewClient(
		marketindex.WithBaseURL(server.URL),
		marketindex.WithFallback(fallback),
	)
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}

	quotes, err := client.FetchAll(context.Background(), []marketindex.Definition{
		{Key: "ibovespa", Label: "Ibovespa", Symbol: "^BVSP"},
	})
	if err != nil {
		t.Fatalf("FetchAll() error = %v", err)
	}
	if len(quotes) != 1 {
		t.Fatalf("quotes = %d, want 1", len(quotes))
	}
	if quotes[0].Error != "" || quotes[0].Price != 169000 {
		t.Errorf("fallback quote = %+v", quotes[0])
	}
}

func TestFetchSnapshotIndices(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if _, err := fmt.Fprint(w, `{"indices":[
			{"key":"ibovespa","label":"Ibovespa","symbol":"^BVSP","price":169000,"change":-1.5,"asOf":"2026-10-29T17:00:00Z"}
		]}`); err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	defer server.Close()

	quotes, err := marketindex.FetchSnapshotIndices(context.Background(), server.Client(), server.URL)
	if err != nil {
		t.Fatalf("FetchSnapshotIndices() error = %v", err)
	}
	if len(quotes) != 1 || quotes[0].Price != 169000 {
		t.Fatalf("quotes = %+v", quotes)
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
