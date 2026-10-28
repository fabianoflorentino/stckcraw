// Package crawler orchestrates fetching every leaderboard variant and writing
// each one to its own CSV file.
package crawler

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"github.com/fabianoflorentino/stckcraw/internal/marketdata"
)

const defaultConcurrency = 4

// Source fetches every quote of a leaderboard variant.
type Source interface {
	Fetch(ctx context.Context, variant marketdata.Variant) ([]marketdata.Quote, error)
}

// Writer persists the quotes of one variant.
type Writer interface {
	Write(ctx context.Context, path string, quotes []marketdata.Quote) error
}

// Result reports the outcome of one variant.
type Result struct {
	Variant marketdata.Variant
	Path    string
	Quotes  int
	Err     error
}

// Reporter receives each finished variant. Calls are serialized.
type Reporter func(Result)

// Crawler downloads and persists leaderboard variants.
type Crawler struct {
	source      Source
	writer      Writer
	outDir      string
	concurrency int
	reporter    Reporter
}

// Option configures a Crawler.
type Option func(*Crawler) error

// WithConcurrency sets how many variants are fetched in parallel.
func WithConcurrency(workers int) Option {
	return func(c *Crawler) error {
		if workers <= 0 {
			return fmt.Errorf("concurrency must be positive, got %d", workers)
		}
		c.concurrency = workers
		return nil
	}
}

// WithReporter installs a progress callback.
func WithReporter(reporter Reporter) Option {
	return func(c *Crawler) error {
		c.reporter = reporter
		return nil
	}
}

// New builds a crawler.
func New(source Source, writer Writer, outDir string, opts ...Option) (*Crawler, error) {
	if source == nil {
		return nil, errors.New("source is required")
	}
	if writer == nil {
		return nil, errors.New("writer is required")
	}
	if strings.TrimSpace(outDir) == "" {
		return nil, errors.New("output directory is required")
	}

	crawler := &Crawler{
		source:      source,
		writer:      writer,
		outDir:      outDir,
		concurrency: defaultConcurrency,
	}

	for _, opt := range opts {
		if err := opt(crawler); err != nil {
			return nil, fmt.Errorf("configure crawler: %w", err)
		}
	}

	return crawler, nil
}

// Run fetches and writes every variant. It does not stop on a single variant
// failure; all outcomes are reported in the result slice. Cancelling ctx stops
// scheduling new work and aborts in-flight requests.
func (c *Crawler) Run(ctx context.Context, variants []marketdata.Variant) []Result {
	results := make([]Result, 0, len(variants))
	sem := make(chan struct{}, c.concurrency)

	var (
		mu sync.Mutex
		wg sync.WaitGroup
	)

	for _, variant := range variants {
		if ctx.Err() != nil {
			break
		}

		sem <- struct{}{}
		wg.Add(1)

		go func(variant marketdata.Variant) {
			defer wg.Done()
			defer func() { <-sem }()

			result := c.runOne(ctx, variant)

			mu.Lock()
			results = append(results, result)
			if c.reporter != nil {
				c.reporter(result)
			}
			mu.Unlock()
		}(variant)
	}

	wg.Wait()

	return results
}

func (c *Crawler) runOne(ctx context.Context, variant marketdata.Variant) Result {
	result := Result{
		Variant: variant,
		Path:    filepath.Join(c.outDir, variant.Filename()),
	}

	quotes, err := c.source.Fetch(ctx, variant)
	if err != nil {
		result.Err = err
		return result
	}

	result.Quotes = len(quotes)

	if err := c.writer.Write(ctx, result.Path, quotes); err != nil {
		result.Err = fmt.Errorf("write %s: %w", result.Path, err)
		return result
	}

	return result
}
