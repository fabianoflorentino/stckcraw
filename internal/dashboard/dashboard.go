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
)

const (
	defaultLimit  = 10
	overFetchRate = 5
)

// TopFetcher fetches ranked assets for one brapi query.
type TopFetcher interface {
	Top(ctx context.Context, req brapi.ListRequest) ([]brapi.Asset, error)
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
	GeneratedAt time.Time `json:"generatedAt"`
	Source      string    `json:"source"`
	Limit       int       `json:"limit"`
	Groups      []Group   `json:"groups"`
	Lows        []Group   `json:"lows"`
}

// Builder assembles a Snapshot from a TopFetcher.
type Builder struct {
	fetcher TopFetcher
	groups  []brapi.Group
	limit   int
	now     func() time.Time
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

	return snapshot, nil
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
