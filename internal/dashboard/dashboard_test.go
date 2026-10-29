package dashboard_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fabianoflorentino/stckcraw/internal/brapi"
	"github.com/fabianoflorentino/stckcraw/internal/dashboard"
	"github.com/fabianoflorentino/stckcraw/internal/marketindex"
)

type fakeFetcher struct {
	assets map[string][]brapi.Asset
	errs   map[string]error
}

func (f fakeFetcher) Top(_ context.Context, req brapi.ListRequest) ([]brapi.Asset, error) {
	key := req.Type + "/" + req.SubType
	if err := f.errs[key]; err != nil {
		return nil, err
	}
	return f.assets[key], nil
}

func TestBuilderBuildsRankedGroups(t *testing.T) {
	t.Parallel()

	fixed := time.Date(2026, 10, 28, 16, 30, 0, 0, time.UTC)
	fetcher := fakeFetcher{assets: map[string][]brapi.Asset{
		"stock/stock": {
			{Symbol: "PETR4F", Name: "Fractional", Close: 10, Change: 30, Volume: 100},
			{Symbol: "PETR4", Name: "Petrobras", Close: 38.5, Change: 1.25, Volume: 1_000_000, MarketCap: ptr(500_000_000_000), Sector: "Energy"},
			{Symbol: "VALE3", Name: "Vale", Close: 61.2, Change: 0.9, Volume: 2_000_000, Sector: "Materials"},
			{Symbol: "ITUB4", Name: "Itaú", Close: 33.1, Change: 0.5, Volume: 3_000_000},
		},
	}}

	groups := []brapi.Group{
		{Key: "acoes", Label: "Ações", Type: "stock", SubType: "stock"},
	}

	builder, err := dashboard.NewBuilder(fetcher,
		dashboard.WithGroups(groups),
		dashboard.WithLimit(2),
		dashboard.WithClock(func() time.Time { return fixed }),
	)
	if err != nil {
		t.Fatalf("NewBuilder() error = %v", err)
	}

	snapshot, err := builder.Build(context.Background())
	if err != nil {
		t.Fatalf("Build() error = %v", err)
	}

	if !snapshot.GeneratedAt.Equal(fixed) {
		t.Errorf("GeneratedAt = %v, want %v", snapshot.GeneratedAt, fixed)
	}
	if snapshot.Source != "brapi.dev" || snapshot.Limit != 2 {
		t.Errorf("unexpected snapshot header: %+v", snapshot)
	}
	if len(snapshot.Groups) != 1 {
		t.Fatalf("groups = %d, want 1", len(snapshot.Groups))
	}

	items := snapshot.Groups[0].Items
	if len(items) != 2 {
		t.Fatalf("items = %d, want 2", len(items))
	}
	if items[0].Symbol != "PETR4" || items[0].Rank != 1 {
		t.Errorf("first item = %+v", items[0])
	}
	if items[1].Symbol != "VALE3" || items[1].Rank != 2 {
		t.Errorf("second item = %+v", items[1])
	}
	if items[0].FinancialVolume != 38_500_000 {
		t.Errorf("FinancialVolume = %v, want 38500000", items[0].FinancialVolume)
	}
	if items[0].MarketCap == nil || *items[0].MarketCap != 500_000_000_000 {
		t.Errorf("MarketCap = %v", items[0].MarketCap)
	}
	if len(snapshot.Lows) != 1 || len(snapshot.Lows[0].Items) != 2 {
		t.Errorf("lows = %+v", snapshot.Lows)
	}
}

type recordingFetcher struct {
	requests []brapi.ListRequest
}

func (f *recordingFetcher) Top(_ context.Context, req brapi.ListRequest) ([]brapi.Asset, error) {
	f.requests = append(f.requests, req)
	return []brapi.Asset{{Symbol: "PETR4", Close: 10, Change: 1}}, nil
}

func TestBuilderFetchesBothDirections(t *testing.T) {
	t.Parallel()

	fetcher := &recordingFetcher{}
	builder, err := dashboard.NewBuilder(fetcher, dashboard.WithGroups([]brapi.Group{
		{Key: "acoes", Label: "Ações", Type: "stock", SubType: "stock"},
	}))
	if err != nil {
		t.Fatalf("NewBuilder() error = %v", err)
	}

	if _, err := builder.Build(context.Background()); err != nil {
		t.Fatalf("Build() error = %v", err)
	}
	if len(fetcher.requests) != 2 {
		t.Fatalf("requests = %d, want 2", len(fetcher.requests))
	}
	if fetcher.requests[0].SortOrder != "desc" {
		t.Errorf("first sort order = %q, want desc", fetcher.requests[0].SortOrder)
	}
	if fetcher.requests[1].SortOrder != "asc" {
		t.Errorf("second sort order = %q, want asc", fetcher.requests[1].SortOrder)
	}
}

type fakeIndexFetcher struct {
	quotes []marketindex.Quote
	err    error
}

func (f fakeIndexFetcher) FetchAll(_ context.Context, _ []marketindex.Definition) ([]marketindex.Quote, error) {
	return f.quotes, f.err
}

func TestBuilderIncludesIndices(t *testing.T) {
	t.Parallel()

	fetcher := fakeFetcher{assets: map[string][]brapi.Asset{
		"stock/stock": {{Symbol: "PETR4", Close: 38.5, Change: 1.2}},
	}}
	indices := fakeIndexFetcher{quotes: []marketindex.Quote{
		{Key: "ibovespa", Label: "Ibovespa", Symbol: "^BVSP", Price: 169081.88, Change: -1.12},
		{Key: "sp500", Label: "S&P 500", Symbol: "^GSPC", Price: 7706.81, Change: -0.48},
	}}

	builder, err := dashboard.NewBuilder(
		fetcher,
		dashboard.WithGroups([]brapi.Group{{Key: "acoes", Label: "Ações", Type: "stock", SubType: "stock"}}),
		dashboard.WithIndexFetcher(indices),
	)
	if err != nil {
		t.Fatalf("NewBuilder() error = %v", err)
	}

	snapshot, err := builder.Build(context.Background())
	if err != nil {
		t.Fatalf("Build() error = %v", err)
	}
	if len(snapshot.Indices) != 2 {
		t.Fatalf("indices = %d, want 2", len(snapshot.Indices))
	}
	if snapshot.Indices[0].Key != "ibovespa" || snapshot.Indices[0].Price != 169081.88 {
		t.Errorf("unexpected index: %+v", snapshot.Indices[0])
	}
}

func TestBuilderIndexFailureIsNotFatal(t *testing.T) {
	t.Parallel()

	fetcher := fakeFetcher{assets: map[string][]brapi.Asset{
		"stock/stock": {{Symbol: "PETR4", Close: 38.5, Change: 1.2}},
	}}
	indices := fakeIndexFetcher{quotes: []marketindex.Quote{
		{Key: "ibovespa", Label: "Ibovespa", Symbol: "^BVSP", Error: "yahoo unavailable"},
	}}

	builder, err := dashboard.NewBuilder(
		fetcher,
		dashboard.WithGroups([]brapi.Group{{Key: "acoes", Label: "Ações", Type: "stock", SubType: "stock"}}),
		dashboard.WithIndexFetcher(indices),
	)
	if err != nil {
		t.Fatalf("NewBuilder() error = %v", err)
	}

	snapshot, err := builder.Build(context.Background())
	if err != nil {
		t.Fatalf("Build() error = %v, want nil", err)
	}
	if len(snapshot.Indices) != 1 || snapshot.Indices[0].Error == "" {
		t.Errorf("unexpected indices: %+v", snapshot.Indices)
	}
}

func TestBuilderKeepsPartialResults(t *testing.T) {
	t.Parallel()

	errBoom := errors.New("boom")
	fetcher := fakeFetcher{
		assets: map[string][]brapi.Asset{
			"stock/stock": {{Symbol: "PETR4", Close: 38.5, Change: 1.2}},
		},
		errs: map[string]error{"fund/fii": errBoom},
	}

	groups := []brapi.Group{
		{Key: "acoes", Label: "Ações", Type: "stock", SubType: "stock"},
		{Key: "fii", Label: "FIIs", Type: "fund", SubType: "fii"},
	}

	builder, err := dashboard.NewBuilder(fetcher, dashboard.WithGroups(groups))
	if err != nil {
		t.Fatalf("NewBuilder() error = %v", err)
	}

	snapshot, err := builder.Build(context.Background())
	if err != nil {
		t.Fatalf("Build() error = %v, want nil error", err)
	}
	if len(snapshot.Groups) != 2 {
		t.Fatalf("groups = %d, want 2", len(snapshot.Groups))
	}
	if len(snapshot.Groups[0].Items) != 1 {
		t.Errorf("first group items = %d, want 1", len(snapshot.Groups[0].Items))
	}
	if snapshot.Groups[1].Error == "" {
		t.Error("second group error is empty, want failure message")
	}
	if snapshot.Lows[1].Error == "" {
		t.Error("second low group error is empty, want failure message")
	}
}

func TestBuilderFailsWhenAllGroupsFail(t *testing.T) {
	t.Parallel()

	fetcher := fakeFetcher{errs: map[string]error{
		"stock/stock": errors.New("stock down"),
		"fund/fii":    errors.New("fii down"),
	}}

	builder, err := dashboard.NewBuilder(fetcher, dashboard.WithGroups([]brapi.Group{
		{Key: "acoes", Label: "Ações", Type: "stock", SubType: "stock"},
		{Key: "fii", Label: "FIIs", Type: "fund", SubType: "fii"},
	}))
	if err != nil {
		t.Fatalf("NewBuilder() error = %v", err)
	}

	if _, err := builder.Build(context.Background()); err == nil {
		t.Fatal("Build() error = nil, want error")
	}
}

func TestBuilderHonorsCancellation(t *testing.T) {
	t.Parallel()

	builder, err := dashboard.NewBuilder(fakeFetcher{}, dashboard.WithGroups([]brapi.Group{
		{Key: "acoes", Label: "Ações", Type: "stock", SubType: "stock"},
	}))
	if err != nil {
		t.Fatalf("NewBuilder() error = %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := builder.Build(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("Build() error = %v, want context.Canceled", err)
	}
}

func TestNewBuilderValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		fetcher dashboard.TopFetcher
		opts    []dashboard.Option
	}{
		{name: "nil fetcher", fetcher: nil},
		{name: "zero limit", fetcher: fakeFetcher{}, opts: []dashboard.Option{dashboard.WithLimit(0)}},
		{name: "empty groups", fetcher: fakeFetcher{}, opts: []dashboard.Option{dashboard.WithGroups(nil)}},
		{name: "nil clock", fetcher: fakeFetcher{}, opts: []dashboard.Option{dashboard.WithClock(nil)}},
		{name: "nil index fetcher", fetcher: fakeFetcher{}, opts: []dashboard.Option{dashboard.WithIndexFetcher(nil)}},
		{name: "empty index definitions", fetcher: fakeFetcher{}, opts: []dashboard.Option{dashboard.WithIndexDefinitions(nil)}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			if _, err := dashboard.NewBuilder(test.fetcher, test.opts...); err == nil {
				t.Fatal("NewBuilder() error = nil, want error")
			}
		})
	}
}

func TestWriteCreatesJSON(t *testing.T) {
	t.Parallel()

	snapshot := dashboard.Snapshot{
		GeneratedAt: time.Date(2026, 10, 28, 16, 30, 0, 0, time.UTC),
		Source:      "test",
		Limit:       1,
		Groups: []dashboard.Group{
			{Key: "acoes", Label: "Ações", Items: []dashboard.Item{
				{Rank: 1, Symbol: "PETR4", Name: "Petrobras", Price: 38.5, Change: 1.25, FinancialVolume: 1000},
			}},
		},
	}

	path := filepath.Join(t.TempDir(), "nested", "latest.json")
	if err := dashboard.Write(context.Background(), path, snapshot); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read output: %v", err)
	}

	var got dashboard.Snapshot
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal output: %v", err)
	}
	if got.Source != "test" || len(got.Groups) != 1 || len(got.Groups[0].Items) != 1 {
		t.Fatalf("unexpected snapshot: %+v", got)
	}
	if got.Groups[0].Items[0].Symbol != "PETR4" {
		t.Errorf("item = %+v", got.Groups[0].Items[0])
	}
}

func TestWriteHonorsCancellation(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	path := filepath.Join(t.TempDir(), "latest.json")
	if err := dashboard.Write(ctx, path, dashboard.Snapshot{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("Write() error = %v, want context.Canceled", err)
	}
}

func ptr(value float64) *float64 { return &value }
