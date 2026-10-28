package brapi_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/fabianoflorentino/stckcraw/internal/brapi"
)

func TestTopBuildsQueryAndParsesResponse(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/quote/list" {
			t.Errorf("path = %q, want /quote/list", r.URL.Path)
		}
		if got := r.URL.Query().Get("sortBy"); got != "change" {
			t.Errorf("sortBy = %q", got)
		}
		if got := r.URL.Query().Get("sortOrder"); got != "desc" {
			t.Errorf("sortOrder = %q", got)
		}
		if got := r.URL.Query().Get("limit"); got != "20" {
			t.Errorf("limit = %q", got)
		}
		if got := r.URL.Query().Get("type"); got != "fund" {
			t.Errorf("type = %q", got)
		}
		if got := r.URL.Query().Get("subType"); got != "fii" {
			t.Errorf("subType = %q", got)
		}
		if got := r.Header.Get("User-Agent"); got == "" {
			t.Error("missing User-Agent")
		}

		w.Header().Set("Content-Type", "application/json")
		if _, err := fmt.Fprint(w, `{"indexes":[{"stock":"^BVSP"}],"stocks":[
			{"stock":"RZZI11","name":"Raizz FII","close":1300,"change":23.81,"volume":1000,"market_cap":null,"sector":"Finance","type":"fund","subType":"fii"}
		]}`); err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	defer server.Close()

	client, err := brapi.NewClient(brapi.WithBaseURL(server.URL))
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}

	assets, err := client.Top(context.Background(), brapi.ListRequest{Type: "fund", SubType: "fii", Limit: 20})
	if err != nil {
		t.Fatalf("Top() error = %v", err)
	}
	if len(assets) != 1 {
		t.Fatalf("Top() returned %d assets, want 1", len(assets))
	}
	if assets[0].Symbol != "RZZI11" || assets[0].Close != 1300 || assets[0].Change != 23.81 {
		t.Errorf("unexpected asset: %+v", assets[0])
	}
	if assets[0].MarketCap != nil {
		t.Errorf("MarketCap = %v, want nil", assets[0].MarketCap)
	}
}

func TestTopRejectsNonOKStatus(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		if _, err := fmt.Fprint(w, `{"error":"rate limit"}`); err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	defer server.Close()

	client, err := brapi.NewClient(brapi.WithBaseURL(server.URL))
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}

	_, err = client.Top(context.Background(), brapi.ListRequest{Type: "stock"})
	if err == nil {
		t.Fatal("Top() error = nil, want error")
	}
}

func TestTopRequiresType(t *testing.T) {
	t.Parallel()

	client, err := brapi.NewClient()
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}

	if _, err := client.Top(context.Background(), brapi.ListRequest{}); err == nil {
		t.Fatal("Top() error = nil, want error")
	}
}

func TestNewClientValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		opts []brapi.Option
	}{
		{name: "empty base URL", opts: []brapi.Option{brapi.WithBaseURL("")}},
		{name: "invalid scheme", opts: []brapi.Option{brapi.WithBaseURL("ftp://example.com")}},
		{name: "empty user agent", opts: []brapi.Option{brapi.WithUserAgent(" ")}},
		{name: "nil http client", opts: []brapi.Option{brapi.WithHTTPClient(nil)}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			if _, err := brapi.NewClient(test.opts...); err == nil {
				t.Fatal("NewClient() error = nil, want error")
			}
		})
	}
}

func TestGroups(t *testing.T) {
	t.Parallel()

	groups := brapi.Groups()
	if len(groups) != 6 {
		t.Fatalf("Groups() returned %d groups, want 6", len(groups))
	}

	seen := make(map[string]struct{}, len(groups))
	for _, group := range groups {
		if group.Key == "" || group.Label == "" || group.Type == "" {
			t.Errorf("incomplete group: %+v", group)
		}
		if _, ok := seen[group.Key]; ok {
			t.Errorf("duplicate group key %q", group.Key)
		}
		seen[group.Key] = struct{}{}
	}
}
