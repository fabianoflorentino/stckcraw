package marketdata

// Quote is one row of the leaderboard, already normalized from the API
// response. Pointer fields preserve the difference between a missing value and
// a legitimate zero.
type Quote struct {
	Symbol          string
	TradeDate       string
	Price           *float64
	Change          *float64
	ChangeMonth     *float64
	ChangeYear      *float64
	Change52W       *float64
	Low             *float64
	High            *float64
	FinancialVolume *float64
}

type leaderboardResponse struct {
	Result      []quoteDTO `json:"result"`
	PageInfo    pageInfo   `json:"pageInfo"`
	TotalPages  *int       `json:"totalPages"`
	TotalRecord *int       `json:"totalRecords"`
}

type pageInfo struct {
	HasNextPage bool `json:"hasNextPage"`
}

type quoteDTO struct {
	Symbol          string   `json:"symbol"`
	Ticker          string   `json:"ticker"`
	TradeDate       string   `json:"tradeDate"`
	Price           *float64 `json:"price"`
	Change          *float64 `json:"change"`
	ChangeMonth     *float64 `json:"changeMonth"`
	ChangeYear      *float64 `json:"changeYear"`
	Change52W       *float64 `json:"change52w"`
	Low             *float64 `json:"low"`
	High            *float64 `json:"high"`
	FinancialVolume *float64 `json:"financialVolume"`
}

func (d quoteDTO) toQuote() Quote {
	symbol := d.Symbol
	if symbol == "" {
		symbol = d.Ticker
	}

	return Quote{
		Symbol:          symbol,
		TradeDate:       d.TradeDate,
		Price:           d.Price,
		Change:          d.Change,
		ChangeMonth:     d.ChangeMonth,
		ChangeYear:      d.ChangeYear,
		Change52W:       d.Change52W,
		Low:             d.Low,
		High:            d.High,
		FinancialVolume: d.FinancialVolume,
	}
}

func (r leaderboardResponse) hasNextPage(page, pageSize int) bool {
	if len(r.Result) == 0 {
		return false
	}
	if r.PageInfo.HasNextPage {
		return true
	}
	if r.TotalPages != nil {
		return page < *r.TotalPages
	}
	if r.TotalRecord != nil {
		return page*pageSize < *r.TotalRecord
	}
	return len(r.Result) >= pageSize
}
