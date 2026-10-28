// Package marketdata maps the InfoMoney leaderboard filters to the underlying
// market data API and fetches quotes from it.
package marketdata

import (
	"errors"
	"fmt"
	"strings"
)

// Market identifies a stock exchange supported by the leaderboard API.
type Market string

// Supported markets.
const (
	MarketB3     Market = "b3"
	MarketNasdaq Market = "nasdaq"
	MarketNYSE   Market = "nyse"
)

// SecurityType is a security class accepted by the B3 leaderboard endpoint.
type SecurityType string

// B3 security types. SecurityAll means no SecurityType filter.
const (
	SecurityAll   SecurityType = ""
	SecurityStock SecurityType = "Quote"
	SecurityFII   SecurityType = "Fii"
	SecurityFIP   SecurityType = "Fip"
	SecurityBDR   SecurityType = "Bdr"
	SecurityETF   SecurityType = "Etf"
	SecurityUnit  SecurityType = "Unity"
)

// Index is a B3 index code accepted by the Index query parameter.
type Index string

// B3 index codes. IndexAll means no Index filter.
const (
	IndexAll  Index = ""
	IndexIBOV Index = "IBOV"
	IndexBDRX Index = "BDRX"
	IndexIBRA Index = "IBRA"
	IndexIBXX Index = "IBXX"
	IndexIBXL Index = "IBXL"
	IndexICO2 Index = "ICO2"
	IndexICON Index = "ICON"
	IndexIDIV Index = "IDIV"
	IndexIEEX Index = "IEEX"
	IndexIFIX Index = "IFIX"
	IndexIFNC Index = "IFNC"
	IndexIGCX Index = "IGCX"
	IndexIGCT Index = "IGCT"
	IndexIGNM Index = "IGNM"
	IndexIMAT Index = "IMAT"
	IndexIMOB Index = "IMOB"
	IndexINDX Index = "INDX"
	IndexISEE Index = "ISEE"
	IndexITAG Index = "ITAG"
	IndexIVBX Index = "IVBX"
	IndexMLCX Index = "MLCX"
	IndexSMLL Index = "SMLL"
	IndexUTIL Index = "UTIL"
)

// Variant is one leaderboard query supported by the page filters.
//
// For B3, SecurityType and Index are mutually exclusive; when both are empty
// the API returns the complete B3 leaderboard. Nasdaq and NYSE expose no
// filters, so both fields stay empty for those markets.
type Variant struct {
	Market       Market
	SecurityType SecurityType
	Index        Index
}

type securityTypeInfo struct {
	value   SecurityType
	slug    string
	label   string
	aliases []string
}

var securityTypes = []securityTypeInfo{
	{SecurityStock, "acao", "Ações", []string{"quote", "acao", "acoes", "stock", "stocks"}},
	{SecurityFII, "fii", "FIIs", []string{"fii", "fiis", "fundo-imobiliario", "fundos-imobiliarios"}},
	{SecurityFIP, "fip", "FIPs", []string{"fip", "fips"}},
	{SecurityBDR, "bdr", "BDRs", []string{"bdr", "bdrs"}},
	{SecurityETF, "etf", "ETFs", []string{"etf", "etfs"}},
	{SecurityUnit, "unit", "Units", []string{"unit", "units", "unity"}},
}

type indexInfo struct {
	value   Index
	label   string
	aliases []string
}

var indices = []indexInfo{
	{IndexIBOV, "Ibovespa (IBOV)", []string{"ibovespa"}},
	{IndexBDRX, "BDRX", nil},
	{IndexIBRA, "Brasil Amplo (IBrA)", nil},
	{IndexIBXX, "Brasil 100 (IBrX 100)", nil},
	{IndexIBXL, "Brasil 50 (IBrX 50)", nil},
	{IndexICO2, "Carbono Eficiente (ICO2)", nil},
	{IndexICON, "Consumo (ICON)", nil},
	{IndexIDIV, "Dividendos (IDIV)", nil}, //nolint:misspell // Portuguese label from the source page
	{IndexIEEX, "Energia Elétrica (IEE)", nil},
	{IndexIFIX, "Fundos Imobiliários (IFIX)", nil},
	{IndexIFNC, "Financeiros (IFNC)", nil},
	{IndexIGCX, "Governança Corporativa Diferenciada (IGC)", nil},
	{IndexIGCT, "Governança Corporativa Trade (IGCT)", nil},
	{IndexIGNM, "Governança Corporativa Novo Mercado (IGC-NM)", nil},
	{IndexIMAT, "Materiais Básicos (IMAT)", nil},
	{IndexIMOB, "Imobiliário (IMOB)", nil},
	{IndexINDX, "Industrial (INDX)", nil},
	{IndexISEE, "Sustentabilidade Empresarial (ISEE)", nil},
	{IndexITAG, "Ações com Tag Along Diferenciado (ITAG)", nil},
	{IndexIVBX, "Valor (IVBX2)", nil},
	{IndexMLCX, "MidLarge Cap (MLCX)", nil},
	{IndexSMLL, "Small Cap (SMLL)", nil},
	{IndexUTIL, "Utilidade Pública (UTIL)", nil},
}

var accentReplacer = strings.NewReplacer(
	"á", "a", "à", "a", "ã", "a", "â", "a",
	"é", "e", "ê", "e",
	"í", "i",
	"ó", "o", "ô", "o", "õ", "o",
	"ú", "u",
	"ç", "c",
)

// IsB3 reports whether the variant targets the B3 leaderboard.
func (v Variant) IsB3() bool { return v.Market == MarketB3 }

// Slug returns a stable, lowercase identifier for the variant, for example
// "b3_ibov" or "nasdaq_todos".
func (v Variant) Slug() string {
	switch {
	case v.SecurityType != SecurityAll:
		return string(v.Market) + "_" + securityTypeSlug(v.SecurityType)
	case v.Index != IndexAll:
		return string(v.Market) + "_" + strings.ToLower(string(v.Index))
	default:
		return string(v.Market) + "_todos"
	}
}

// Filename returns the CSV filename used for the variant.
func (v Variant) Filename() string { return v.Slug() + ".csv" }

// Label returns a human-readable description of the variant.
func (v Variant) Label() string {
	switch {
	case v.SecurityType != SecurityAll:
		return marketLabel(v.Market) + " / " + securityTypeLabel(v.SecurityType)
	case v.Index != IndexAll:
		return marketLabel(v.Market) + " / " + indexLabel(v.Index)
	default:
		return marketLabel(v.Market) + " / Todos"
	}
}

// B3Variants returns every filter combination offered for B3: the complete
// leaderboard, the six security types and the 23 indices.
func B3Variants() []Variant {
	variants := make([]Variant, 0, 1+len(securityTypes)+len(indices))
	variants = append(variants, Variant{Market: MarketB3})
	for _, info := range securityTypes {
		variants = append(variants, Variant{Market: MarketB3, SecurityType: info.value})
	}
	for _, info := range indices {
		variants = append(variants, Variant{Market: MarketB3, Index: info.value})
	}
	return variants
}

// AllVariants returns every CSV variant the page can export: 30 B3 queries
// plus the Nasdaq and NYSE leaderboards.
func AllVariants() []Variant {
	variants := B3Variants()
	return append(variants, Variant{Market: MarketNasdaq}, Variant{Market: MarketNYSE})
}

// SelectVariants resolves the CLI filter arguments into concrete variants.
// The values "all" and "todos" mean no filter. Filtering by type or index is
// only available for B3, and the two filters are mutually exclusive.
func SelectVariants(marketArg, typeArg, indexArg string) ([]Variant, error) {
	marketArg = normalize(marketArg)
	if marketArg == "" {
		marketArg = "all"
	}

	typeArg = normalize(typeArg)
	if typeArg == "" {
		typeArg = "all"
	}

	indexArg = normalize(indexArg)
	if indexArg == "" {
		indexArg = "all"
	}

	allTypes := typeArg == "all" || typeArg == "todos"
	allIndices := indexArg == "all" || indexArg == "todos"

	if !allTypes && !allIndices {
		return nil, errors.New("type and index filters are mutually exclusive")
	}

	if marketArg == "all" || marketArg == "todos" {
		if !allTypes || !allIndices {
			return nil, errors.New("use market b3 when filtering by type or index")
		}
		return AllVariants(), nil
	}

	market, ok := parseMarket(marketArg)
	if !ok {
		return nil, fmt.Errorf("unknown market %q: want b3, nasdaq, nyse or all", marketArg)
	}
	if market != MarketB3 && (!allTypes || !allIndices) {
		return nil, errors.New("type and index filters only apply to b3")
	}

	switch market {
	case MarketNasdaq, MarketNYSE:
		return []Variant{{Market: market}}, nil
	case MarketB3:
		if allTypes && allIndices {
			return B3Variants(), nil
		}
		if !allTypes {
			securityType, ok := parseSecurityType(typeArg)
			if !ok {
				return nil, fmt.Errorf("unknown type %q", typeArg)
			}
			return []Variant{{Market: MarketB3, SecurityType: securityType}}, nil
		}
		index, ok := parseIndex(indexArg)
		if !ok {
			return nil, fmt.Errorf("unknown index %q", indexArg)
		}
		return []Variant{{Market: MarketB3, Index: index}}, nil
	default:
		return nil, fmt.Errorf("unsupported market %q", market)
	}
}

func normalize(value string) string {
	return accentReplacer.Replace(strings.ToLower(strings.TrimSpace(value)))
}

func parseMarket(value string) (Market, bool) {
	switch Market(value) {
	case MarketB3, MarketNasdaq, MarketNYSE:
		return Market(value), true
	default:
		return "", false
	}
}

func parseSecurityType(value string) (SecurityType, bool) {
	for _, info := range securityTypes {
		if value == info.slug || value == normalize(info.label) {
			return info.value, true
		}
		for _, alias := range info.aliases {
			if value == alias {
				return info.value, true
			}
		}
	}
	return SecurityAll, false
}

func parseIndex(value string) (Index, bool) {
	for _, info := range indices {
		if value == strings.ToLower(string(info.value)) {
			return info.value, true
		}
		for _, alias := range info.aliases {
			if value == alias {
				return info.value, true
			}
		}
	}
	return IndexAll, false
}

func securityTypeSlug(value SecurityType) string {
	for _, info := range securityTypes {
		if info.value == value {
			return info.slug
		}
	}
	return strings.ToLower(string(value))
}

func securityTypeLabel(value SecurityType) string {
	for _, info := range securityTypes {
		if info.value == value {
			return info.label
		}
	}
	return string(value)
}

func indexLabel(value Index) string {
	for _, info := range indices {
		if info.value == value {
			return info.label
		}
	}
	return string(value)
}

func marketLabel(market Market) string {
	switch market {
	case MarketB3:
		return "B3"
	case MarketNasdaq:
		return "Nasdaq"
	case MarketNYSE:
		return "NYSE"
	default:
		return string(market)
	}
}
