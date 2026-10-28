package brapi

// Group is one dashboard section backed by a brapi type/subType pair.
type Group struct {
	Key     string
	Label   string
	Type    string
	SubType string
}

// Groups returns the B3 sections shown on the dashboard, in display order.
func Groups() []Group {
	return []Group{
		{Key: "acoes", Label: "Ações", Type: "stock", SubType: "stock"},
		{Key: "fii", Label: "FIIs", Type: "fund", SubType: "fii"},
		{Key: "fip", Label: "FIPs", Type: "fund", SubType: "fip"},
		{Key: "etf", Label: "ETFs", Type: "fund", SubType: "etf"},
		{Key: "bdr", Label: "BDRs", Type: "bdr"},
		{Key: "unit", Label: "Units", Type: "stock", SubType: "unit"},
	}
}
