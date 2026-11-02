// Package dashboard builds and persists the normalized JSON snapshot consumed
// by the GitHub Pages frontend.
package dashboard

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/fabianoflorentino/stckcraw/internal/brapi"
	"github.com/fabianoflorentino/stckcraw/internal/marketindex"
)

const (
	defaultLimit  = 10
	overFetchRate = 5
	b3IndexKey    = "ibovespa"
)

// TopFetcher fetches ranked assets for one brapi query.
type TopFetcher interface {
	Top(ctx context.Context, req brapi.ListRequest) ([]brapi.Asset, error)
}

// IndexFetcher fetches the major market indices shown above the B3 tables.
type IndexFetcher interface {
	FetchAll(ctx context.Context, definitions []marketindex.Definition) ([]marketindex.Quote, error)
}

// Item is one row in a dashboard group.
type Item struct {
	Rank            int      `json:"rank"`
	Symbol          string   `json:"symbol"`
	Name            string   `json:"name"`
	Price           float64  `json:"price"`
	Change          float64  `json:"change"`
	FinancialVolume float64  `json:"financialVolume"`
	MarketCap       *float64 `json:"marketCap,omitempty"`
	Sector          string   `json:"sector,omitempty"`
}

// Group is one dashboard section.
type Group struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Items []Item `json:"items"`
	Error string `json:"error,omitempty"`
}

// Snapshot is the JSON document published to GitHub Pages.
type Snapshot struct {
	GeneratedAt time.Time           `json:"generatedAt"`
	Source      string              `json:"source"`
	Limit       int                 `json:"limit"`
	Groups      []Group             `json:"groups"`
	Lows        []Group             `json:"lows"`
	Indices     []marketindex.Quote `json:"indices"`
	// B3AsOf is the Ibovespa timestamp, used as the last B3 session marker.
	B3AsOf time.Time `json:"b3AsOf"`
	// B3Closed reports that the last B3 session is from an earlier UTC day,
	// which happens on weekends and B3 holidays.
	B3Closed bool `json:"b3Closed,omitempty"`
}

// Builder assembles a Snapshot from a TopFetcher.
type Builder struct {
	fetcher      TopFetcher
	indexFetcher IndexFetcher
	groups       []brapi.Group
	indices      []marketindex.Definition
	limit        int
	now          func() time.Time
}

// Option configures a Builder.
type Option func(*Builder) error

// WithLimit sets how many items each group contains.
func WithLimit(limit int) Option {
	return func(b *Builder) error {
		if limit <= 0 {
			return fmt.Errorf("limit must be positive, got %d", limit)
		}
		b.limit = limit
		return nil
	}
}

// WithIndexFetcher sets the optional market index source.
func WithIndexFetcher(fetcher IndexFetcher) Option {
	return func(b *Builder) error {
		if fetcher == nil {
			return errors.New("index fetcher must not be nil")
		}
		b.indexFetcher = fetcher
		return nil
	}
}

// WithIndexDefinitions overrides the indices shown on the dashboard.
func WithIndexDefinitions(definitions []marketindex.Definition) Option {
	return func(b *Builder) error {
		if len(definitions) == 0 {
			return errors.New("at least one index definition is required")
		}
		b.indices = append([]marketindex.Definition(nil), definitions...)
		return nil
	}
}

// WithGroups overrides the dashboard groups.
func WithGroups(groups []brapi.Group) Option {
	return func(b *Builder) error {
		if len(groups) == 0 {
			return errors.New("at least one group is required")
		}
		b.groups = append([]brapi.Group(nil), groups...)
		return nil
	}
}

// WithClock overrides the current time, which is useful for deterministic tests.
func WithClock(now func() time.Time) Option {
	return func(b *Builder) error {
		if now == nil {
			return errors.New("clock must not be nil")
		}
		b.now = now
		return nil
	}
}

// NewBuilder builds a dashboard Builder.
func NewBuilder(fetcher TopFetcher, opts ...Option) (*Builder, error) {
	if fetcher == nil {
		return nil, errors.New("fetcher is required")
	}

	builder := &Builder{
		fetcher: fetcher,
		groups:  brapi.Groups(),
		indices: marketindex.DefaultIndices(),
		limit:   defaultLimit,
		now:     time.Now,
	}

	for _, opt := range opts {
		if err := opt(builder); err != nil {
			return nil, fmt.Errorf("configure dashboard builder: %w", err)
		}
	}

	return builder, nil
}

// Build fetches the biggest gains and losses for every group. A failing
// direction is recorded in the snapshot and does not prevent the other data
// from being published. Build only returns an error when every query fails or
// the context is cancelled.
func (b *Builder) Build(ctx context.Context) (Snapshot, error) {
	snapshot := Snapshot{
		GeneratedAt: b.now().UTC(),
		Source:      "brapi.dev",
		Limit:       b.limit,
		Groups:      make([]Group, 0, len(b.groups)),
		Lows:        make([]Group, 0, len(b.groups)),
		Indices:     make([]marketindex.Quote, 0, len(b.indices)),
	}

	var (
		failures  []error
		successes int
	)

	for _, group := range b.groups {
		if err := ctx.Err(); err != nil {
			return snapshot, err
		}

		highs, highErr := b.fetcher.Top(ctx, brapi.ListRequest{
			Type:      group.Type,
			SubType:   group.SubType,
			Limit:     b.limit * overFetchRate,
			SortOrder: "desc",
		})
		if err := ctx.Err(); err != nil {
			return snapshot, err
		}

		lows, lowErr := b.fetcher.Top(ctx, brapi.ListRequest{
			Type:      group.Type,
			SubType:   group.SubType,
			Limit:     b.limit * overFetchRate,
			SortOrder: "asc",
		})
		if err := ctx.Err(); err != nil {
			return snapshot, err
		}

		snapshot.Groups = append(snapshot.Groups, b.groupResult(group, highs, highErr))
		snapshot.Lows = append(snapshot.Lows, b.groupResult(group, lows, lowErr))

		if highErr == nil || lowErr == nil {
			successes++
		}
		if highErr != nil {
			failures = append(failures, fmt.Errorf("%s highs: %w", group.Key, highErr))
		}
		if lowErr != nil {
			failures = append(failures, fmt.Errorf("%s lows: %w", group.Key, lowErr))
		}
	}

	if successes == 0 {
		return snapshot, fmt.Errorf("all dashboard groups failed: %w", errors.Join(failures...))
	}

	if b.indexFetcher != nil {
		indices, err := b.indexFetcher.FetchAll(ctx, b.indices)
		if err != nil {
			return snapshot, fmt.Errorf("fetch market indices: %w", err)
		}
		snapshot.Indices = indices
		snapshot.B3AsOf, snapshot.B3Closed = b3Session(indices, snapshot.GeneratedAt)
	}

	return snapshot, nil
}

// b3Session returns the last B3 session timestamp and whether it falls on an
// earlier UTC day than generatedAt. The Ibovespa quote is the reference:
// B3 trading and after-market sessions end before 00:00 UTC, so a date
// mismatch means the exchange did not trade on generatedAt's date.
func b3Session(indices []marketindex.Quote, generatedAt time.Time) (time.Time, bool) {
	for _, index := range indices {
		if index.Key != b3IndexKey || index.Error != "" || index.AsOf.IsZero() {
			continue
		}
		return index.AsOf, utcDate(index.AsOf).Before(utcDate(generatedAt))
	}

	return time.Time{}, false
}

func utcDate(value time.Time) time.Time {
	year, month, day := value.UTC().Date()
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}

func (b *Builder) groupResult(group brapi.Group, assets []brapi.Asset, err error) Group {
	if err != nil {
		return Group{
			Key:   group.Key,
			Label: group.Label,
			Items: []Item{},
			Error: err.Error(),
		}
	}

	return Group{
		Key:   group.Key,
		Label: group.Label,
		Items: b.items(assets, group),
	}
}

func (b *Builder) items(assets []brapi.Asset, group brapi.Group) []Item {
	items := make([]Item, 0, b.limit)

	for _, asset := range assets {
		if isFractional(asset.Symbol) {
			continue
		}

		items = append(items, Item{
			Rank:            len(items) + 1,
			Symbol:          asset.Symbol,
			Name:            asset.Name,
			Price:           asset.Close,
			Change:          asset.Change,
			FinancialVolume: math.Round(asset.Close*asset.Volume*100) / 100,
			MarketCap:       asset.MarketCap,
			Sector:          asset.Sector,
		})

		if len(items) == b.limit {
			break
		}
	}

	return items
}

func isFractional(symbol string) bool {
	return strings.HasSuffix(strings.ToUpper(strings.TrimSpace(symbol)), "F")
}
