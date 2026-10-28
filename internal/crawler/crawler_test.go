package crawler_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/fabianoflorentino/stckcraw/internal/crawler"
	"github.com/fabianoflorentino/stckcraw/internal/marketdata"
)

type fakeSource struct {
	quotes map[string][]marketdata.Quote
	errs   map[string]error
}

func (f fakeSource) Fetch(_ context.Context, variant marketdata.Variant) ([]marketdata.Quote, error) {
	if err := f.errs[variant.Slug()]; err != nil {
		return nil, err
	}
	return f.quotes[variant.Slug()], nil
}

type recordedWrite struct {
	path   string
	quotes int
}

type fakeWriter struct {
	mu     sync.Mutex
	writes []recordedWrite
	err    error
}

func (f *fakeWriter) Write(_ context.Context, path string, quotes []marketdata.Quote) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.err != nil {
		return f.err
	}

	f.writes = append(f.writes, recordedWrite{path: path, quotes: len(quotes)})
	return nil
}

func TestCrawlerRun(t *testing.T) {
	t.Parallel()

	variants := []marketdata.Variant{
		{Market: marketdata.MarketB3, Index: marketdata.IndexIBOV},
		{Market: marketdata.MarketNasdaq},
	}
	source := fakeSource{quotes: map[string][]marketdata.Quote{
		"b3_ibov":      {{Symbol: "PETR4"}, {Symbol: "VALE3"}},
		"nasdaq_todos": {{Symbol: "AAPL"}},
	}}
	writer := &fakeWriter{}

	var reported []crawler.Result

	engine, err := crawler.New(
		source,
		writer,
		t.TempDir(),
		crawler.WithConcurrency(2),
		crawler.WithReporter(func(result crawler.Result) {
			reported = append(reported, result)
		}),
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	results := engine.Run(context.Background(), variants)
	if len(results) != 2 {
		t.Fatalf("Run() returned %d results, want 2", len(results))
	}
	if len(reported) != 2 {
		t.Errorf("reporter called %d times, want 2", len(reported))
	}

	bySlug := make(map[string]crawler.Result, len(results))
	for _, result := range results {
		if result.Err != nil {
			t.Errorf("%s: unexpected error: %v", result.Variant.Slug(), result.Err)
		}
		bySlug[result.Variant.Slug()] = result
	}

	if got := bySlug["b3_ibov"]; got.Quotes != 2 || !strings.HasSuffix(got.Path, "b3_ibov.csv") {
		t.Errorf("b3_ibov result = %+v", got)
	}
	if got := bySlug["nasdaq_todos"]; got.Quotes != 1 || !strings.HasSuffix(got.Path, "nasdaq_todos.csv") {
		t.Errorf("nasdaq result = %+v", got)
	}
	if len(writer.writes) != 2 {
		t.Errorf("writer called %d times, want 2", len(writer.writes))
	}
}

func TestCrawlerRunIsolatesFailures(t *testing.T) {
	t.Parallel()

	errBoom := errors.New("boom")
	variants := []marketdata.Variant{
		{Market: marketdata.MarketB3, Index: marketdata.IndexIBOV},
		{Market: marketdata.MarketNYSE},
	}
	source := fakeSource{
		quotes: map[string][]marketdata.Quote{"nyse_todos": {{Symbol: "KO"}}},
		errs:   map[string]error{"b3_ibov": errBoom},
	}

	engine, err := crawler.New(source, &fakeWriter{}, t.TempDir())
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	results := engine.Run(context.Background(), variants)
	if len(results) != 2 {
		t.Fatalf("Run() returned %d results, want 2", len(results))
	}

	var failures, successes int
	for _, result := range results {
		switch {
		case result.Err == nil:
			successes++
		case errors.Is(result.Err, errBoom):
			failures++
		default:
			t.Errorf("unexpected error: %v", result.Err)
		}
	}
	if failures != 1 || successes != 1 {
		t.Errorf("failures = %d, successes = %d, want 1 and 1", failures, successes)
	}
}

func TestCrawlerRunStopsOnCancellation(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	engine, err := crawler.New(fakeSource{}, &fakeWriter{}, t.TempDir())
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	results := engine.Run(ctx, []marketdata.Variant{{Market: marketdata.MarketB3}})
	if len(results) != 0 {
		t.Fatalf("Run() returned %d results, want 0", len(results))
	}
}

func TestCrawlerNewValidation(t *testing.T) {
	t.Parallel()

	writer := &fakeWriter{}

	tests := []struct {
		name   string
		source crawler.Source
		writer crawler.Writer
		outDir string
		opts   []crawler.Option
	}{
		{name: "nil source", source: nil, writer: writer, outDir: t.TempDir()},
		{name: "nil writer", source: fakeSource{}, writer: nil, outDir: t.TempDir()},
		{name: "empty outDir", source: fakeSource{}, writer: writer, outDir: " "},
		{name: "invalid concurrency", source: fakeSource{}, writer: writer, outDir: t.TempDir(), opts: []crawler.Option{crawler.WithConcurrency(0)}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			if _, err := crawler.New(test.source, test.writer, test.outDir, test.opts...); err == nil {
				t.Fatal("New() error = nil, want error")
			}
		})
	}
}
