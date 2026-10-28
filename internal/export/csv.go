// Package export renders fetched quotes as CSV files.
package export

import (
	"context"
	"encoding/csv"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // keep America/Sao_Paulo available on minimal hosts

	"github.com/fabianoflorentino/stckcraw/internal/marketdata"
)

// Format selects how quote values are rendered in the CSV.
type Format int

// Supported output formats.
const (
	// FormatSite mirrors the CSV produced by the InfoMoney page button.
	FormatSite Format = iota
	// FormatRaw writes the API numbers without display formatting.
	FormatRaw
)

// ParseFormat resolves a user-supplied format name.
func ParseFormat(value string) (Format, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "site", "info money", "infomoney":
		return FormatSite, nil
	case "raw", "cru":
		return FormatRaw, nil
	default:
		return FormatSite, fmt.Errorf("unknown format %q: want site or raw", value)
	}
}

// String returns the canonical format name.
func (f Format) String() string {
	if f == FormatRaw {
		return "raw"
	}
	return "site"
}

var header = []string{
	"Ativo",
	"Data",
	"Último (R$)",
	"Var. Dia (%)",
	"Var. Mês (%)",
	"Var. Ano (%)",
	"Var. 12M (%)",
	"Val. Mín",
	"Val. Máx",
	"Volume",
}

// Formatter turns a marketdata.Quote into a CSV row.
type Formatter struct {
	format   Format
	location *time.Location
	now      func() time.Time
}

// FormatterOption configures a Formatter.
type FormatterOption func(*Formatter)

// WithLocation sets the timezone used to format trade dates.
func WithLocation(location *time.Location) FormatterOption {
	return func(f *Formatter) {
		if location != nil {
			f.location = location
		}
	}
}

// WithClock overrides the current time, which is useful for deterministic tests.
func WithClock(now func() time.Time) FormatterOption {
	return func(f *Formatter) {
		if now != nil {
			f.now = now
		}
	}
}

// NewFormatter builds a Formatter for the given format.
func NewFormatter(format Format, opts ...FormatterOption) *Formatter {
	location, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		location = time.FixedZone("BRT", -3*60*60)
	}

	formatter := &Formatter{
		format:   format,
		location: location,
		now:      time.Now,
	}

	for _, opt := range opts {
		opt(formatter)
	}

	return formatter
}

// Header returns a copy of the CSV header.
func (f *Formatter) Header() []string {
	return append([]string(nil), header...)
}

// Row renders a quote according to the configured format.
func (f *Formatter) Row(quote marketdata.Quote) []string {
	if f.format == FormatRaw {
		return f.rawRow(quote)
	}
	return f.siteRow(quote)
}

func (f *Formatter) rawRow(quote marketdata.Quote) []string {
	return []string{
		quote.Symbol,
		quote.TradeDate,
		rawFloat(quote.Price),
		rawFloat(quote.Change),
		rawFloat(quote.ChangeMonth),
		rawFloat(quote.ChangeYear),
		rawFloat(quote.Change52W),
		rawFloat(quote.Low),
		rawFloat(quote.High),
		rawFloat(quote.FinancialVolume),
	}
}

func (f *Formatter) siteRow(quote marketdata.Quote) []string {
	return []string{
		quote.Symbol,
		f.formatDate(quote.TradeDate),
		siteMoney(quote.Price),
		sitePercent(quote.Change),
		sitePercent(quote.ChangeMonth),
		sitePercent(quote.ChangeYear),
		sitePercent(quote.Change52W),
		siteMoney(quote.Low),
		siteMoney(quote.High),
		siteVolume(quote.FinancialVolume),
	}
}

func (f *Formatter) formatDate(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}

	tradeDate, ok := f.parseDate(raw)
	if !ok {
		return ""
	}
	tradeDate = tradeDate.In(f.location)

	if sameDay(tradeDate, f.now().In(f.location)) {
		return tradeDate.Format("15") + "h" + tradeDate.Format("04")
	}

	return tradeDate.Format("02/01")
}

func (f *Formatter) parseDate(raw string) (time.Time, bool) {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return parsed, true
		}
	}

	for _, layout := range []string{
		"2006-01-02T15:04:05.000",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
		"02/01/2006",
	} {
		if parsed, err := time.ParseInLocation(layout, raw, f.location); err == nil {
			return parsed, true
		}
	}

	return time.Time{}, false
}

func sameDay(a, b time.Time) bool {
	ay, am, ad := a.Date()
	by, bm, bd := b.Date()
	return ay == by && am == bm && ad == bd
}

func rawFloat(value *float64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatFloat(*value, 'f', -1, 64)
}

func siteMoney(value *float64) string {
	if value == nil {
		return "-"
	}
	if *value == 0 {
		return "0,00"
	}

	truncated := math.Floor(*value*100) / 100
	return strings.ReplaceAll(strconv.FormatFloat(truncated, 'f', 2, 64), ".", ",")
}

func sitePercent(value *float64) string {
	if value == nil {
		return "-"
	}

	sign := ""
	if *value > 0 {
		sign = "+"
	}

	return sign + strings.ReplaceAll(strconv.FormatFloat(*value, 'f', 2, 64), ".", ",") + "%"
}

func siteVolume(value *float64) string {
	if value == nil {
		return "-"
	}

	switch volume := *value; {
	case volume >= 1e9:
		return strconv.FormatFloat(volume/1e9, 'f', 1, 64) + "B"
	case volume >= 1e6:
		return strconv.FormatFloat(volume/1e6, 'f', 1, 64) + "M"
	case volume >= 1e3:
		return strconv.FormatFloat(volume/1e3, 'f', 1, 64) + "K"
	default:
		return strconv.FormatFloat(volume, 'f', -1, 64)
	}
}

// Writer writes quotes to a CSV file.
type Writer struct {
	formatter *Formatter
}

// NewWriter builds a CSV writer for the given format.
func NewWriter(format Format, opts ...FormatterOption) *Writer {
	return &Writer{formatter: NewFormatter(format, opts...)}
}

// Write creates path and writes the header followed by every quote.
func (w *Writer) Write(ctx context.Context, path string, quotes []marketdata.Quote) (err error) {
	if err := ctx.Err(); err != nil {
		return err
	}

	if dir := filepath.Dir(path); dir != "." {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return fmt.Errorf("create output directory: %w", err)
		}
	}

	//nolint:gosec // the output path is explicitly supplied by the user
	file, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create %s: %w", path, err)
	}
	defer func() {
		closeErr := file.Close()
		if err == nil && closeErr != nil {
			err = fmt.Errorf("close %s: %w", path, closeErr)
		}
	}()

	csvWriter := csv.NewWriter(file)
	if err := csvWriter.Write(w.formatter.Header()); err != nil {
		return fmt.Errorf("write header to %s: %w", path, err)
	}

	for _, quote := range quotes {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := csvWriter.Write(w.formatter.Row(quote)); err != nil {
			return fmt.Errorf("write row to %s: %w", path, err)
		}
	}

	csvWriter.Flush()
	if err := csvWriter.Error(); err != nil {
		return fmt.Errorf("flush %s: %w", path, err)
	}

	return nil
}
