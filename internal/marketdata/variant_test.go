package marketdata_test

import (
	"testing"

	"github.com/fabianoflorentino/stckcraw/internal/marketdata"
)

func TestAllVariants(t *testing.T) {
	t.Parallel()

	variants := marketdata.AllVariants()
	if len(variants) != 32 {
		t.Fatalf("AllVariants() returned %d variants, want 32", len(variants))
	}

	seen := make(map[string]struct{}, len(variants))
	for _, variant := range variants {
		slug := variant.Slug()
		if _, ok := seen[slug]; ok {
			t.Errorf("duplicate slug %q", slug)
		}
		seen[slug] = struct{}{}
	}

	for _, slug := range []string{"b3_todos", "b3_acao", "b3_ibov", "nasdaq_todos", "nyse_todos"} {
		if _, ok := seen[slug]; !ok {
			t.Errorf("missing variant %q", slug)
		}
	}
}

func TestSelectVariants(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		market       string
		securityType string
		index        string
		wantCount    int
		wantSlug     string
		wantErr      bool
	}{
		{name: "all markets", market: "all", securityType: "all", index: "all", wantCount: 32},
		{name: "b3 all", market: "b3", securityType: "all", index: "all", wantCount: 30},
		{name: "b3 security type", market: "b3", securityType: "acao", index: "all", wantCount: 1, wantSlug: "b3_acao"},
		{name: "b3 index", market: "b3", securityType: "all", index: "ibov", wantCount: 1, wantSlug: "b3_ibov"},
		{name: "nasdaq", market: "nasdaq", securityType: "all", index: "all", wantCount: 1, wantSlug: "nasdaq_todos"},
		{name: "nyse", market: "nyse", securityType: "all", index: "all", wantCount: 1, wantSlug: "nyse_todos"},
		{name: "mutually exclusive", market: "b3", securityType: "acao", index: "ibov", wantErr: true},
		{name: "filter requires b3", market: "all", securityType: "acao", index: "all", wantErr: true},
		{name: "type on nasdaq", market: "nasdaq", securityType: "acao", index: "all", wantErr: true},
		{name: "unknown market", market: "crypto", securityType: "all", index: "all", wantErr: true},
		{name: "unknown type", market: "b3", securityType: "warrant", index: "all", wantErr: true},
		{name: "unknown index", market: "b3", securityType: "all", index: "nope", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			variants, err := marketdata.SelectVariants(test.market, test.securityType, test.index)
			if test.wantErr {
				if err == nil {
					t.Fatalf("SelectVariants() error = nil, want error; variants = %v", variants)
				}
				return
			}
			if err != nil {
				t.Fatalf("SelectVariants() error = %v", err)
			}
			if len(variants) != test.wantCount {
				t.Fatalf("SelectVariants() returned %d variants, want %d", len(variants), test.wantCount)
			}
			if test.wantSlug != "" && variants[0].Slug() != test.wantSlug {
				t.Errorf("first slug = %q, want %q", variants[0].Slug(), test.wantSlug)
			}
		})
	}
}
