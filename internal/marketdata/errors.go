package marketdata

import "errors"

// ErrConfigNotFound indicates that the InfoMoney page did not expose the
// market data base URL and subscription key.
var ErrConfigNotFound = errors.New("market data configuration not found in page")

// ErrAccessBlocked indicates that the market data API rejected the request
// with HTTP 403, typically because of the edge/WAF block on the client IP.
var ErrAccessBlocked = errors.New("market data API access blocked")
