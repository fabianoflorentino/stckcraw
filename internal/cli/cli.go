// Package cli implements the stckcraw command-line interface.
package cli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/fabianoflorentino/stckcraw/internal/brapi"
	"github.com/fabianoflorentino/stckcraw/internal/crawler"
	"github.com/fabianoflorentino/stckcraw/internal/dashboard"
	"github.com/fabianoflorentino/stckcraw/internal/export"
	"github.com/fabianoflorentino/stckcraw/internal/marketdata"
)

// Process exit codes.
const (
	ExitOK    = 0
	ExitError = 1
	ExitUsage = 2
)

// Version is the build version, injected through -ldflags.
var Version = "dev"

type options struct {
	outDir         string
	market         string
	securityType   string
	index          string
	pageSize       int
	concurrency    int
	format         export.Format
	pageURL        string
	baseURL        string
	apiKey         string
	requestTimeout time.Duration
	maxPages       int
	list           bool
	showVersion    bool
	variants       []marketdata.Variant
	dashboard      bool
	dashboardLimit int
	brapiBaseURL   string
}

type usageError struct {
	err error
}

func (e usageError) Error() string { return e.err.Error() }

func (e usageError) Unwrap() error { return e.err }

// Run executes the CLI and returns the process exit code.
func Run(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	opts, err := parse(args, stderr)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return ExitOK
		}

		writeFormat(stderr, "stckcraw: %v\n", err)

		var usageErr usageError
		if errors.As(err, &usageErr) {
			return ExitUsage
		}

		return ExitError
	}

	if opts.showVersion {
		writeFormat(stdout, "stckcraw %s\n", Version)
		return ExitOK
	}

	if err := run(ctx, opts, stdout, stderr); err != nil {
		writeFormat(stderr, "stckcraw: %v\n", err)
		return ExitError
	}

	return ExitOK
}

func parse(args []string, stderr io.Writer) (options, error) {
	flags := flag.NewFlagSet("stckcraw", flag.ContinueOnError)
	flags.SetOutput(stderr)

	var (
		outDir         = flags.String("out", "data", "output directory for CSV files or dashboard JSON")
		market         = flags.String("market", "all", "market: b3, nasdaq, nyse or all")
		securityType   = flags.String("type", "all", "B3 security type: all, acao, fii, fip, bdr, etf or unit")
		index          = flags.String("index", "all", "B3 index: all or a code such as IBOV")
		pageSize       = flags.Int("page-size", 100, "quotes requested per API page")
		concurrency    = flags.Int("concurrency", 4, "variants fetched in parallel")
		formatArg      = flags.String("format", "site", "CSV format: site or raw")
		pageURL        = flags.String("page-url", marketdata.DefaultPageURL, "page used to discover the API credentials")
		baseURL        = flags.String("base-url", "", "override the market data API base URL")
		apiKey         = flags.String("api-key", "", "override the market data API subscription key")
		requestTimeout = flags.Duration("request-timeout", 30*time.Second, "timeout for each HTTP request")
		maxPages       = flags.Int("max-pages", 1000, "maximum pages fetched per variant")
		list           = flags.Bool("list", false, "list variants and exit")
		showVersion    = flags.Bool("version", false, "print version and exit")
		dashboardMode  = flags.Bool("dashboard", false, "generate the dashboard JSON instead of CSV")
		dashboardLimit = flags.Int("limit", 10, "items per dashboard group")
		brapiBaseURL   = flags.String("brapi-base-url", brapi.DefaultBaseURL, "brapi.dev API base URL")
	)

	flags.Usage = func() {
		writeLine(stderr, "Usage: stckcraw [flags]")
		writeLine(stderr)
		writeLine(stderr, "Downloads InfoMoney altas/baixas leaderboards as CSV or generates the dashboard JSON.")
		writeLine(stderr)
		writeLine(stderr, "Flags:")
		flags.PrintDefaults()
	}

	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return options{}, err
		}
		return options{}, usageError{err}
	}

	if flags.NArg() > 0 {
		return options{}, usageError{fmt.Errorf("unexpected arguments: %s", strings.Join(flags.Args(), " "))}
	}
	if strings.TrimSpace(*outDir) == "" {
		return options{}, usageError{errors.New("output directory must not be empty")}
	}
	if *requestTimeout <= 0 {
		return options{}, usageError{fmt.Errorf("request timeout must be positive, got %s", *requestTimeout)}
	}

	if *dashboardMode {
		if *list {
			return options{}, usageError{errors.New("-list and -dashboard are mutually exclusive")}
		}
		if *dashboardLimit <= 0 {
			return options{}, usageError{fmt.Errorf("dashboard limit must be positive, got %d", *dashboardLimit)}
		}

		parsed, err := url.Parse(*brapiBaseURL)
		if err != nil {
			return options{}, usageError{fmt.Errorf("parse brapi base URL: %w", err)}
		}
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return options{}, usageError{fmt.Errorf("brapi base URL scheme must be http or https, got %q", parsed.Scheme)}
		}
		if parsed.Host == "" {
			return options{}, usageError{errors.New("brapi base URL must include a host")}
		}

		return options{
			outDir:         *outDir,
			requestTimeout: *requestTimeout,
			showVersion:    *showVersion,
			dashboard:      true,
			dashboardLimit: *dashboardLimit,
			brapiBaseURL:   *brapiBaseURL,
		}, nil
	}

	if strings.TrimSpace(*pageURL) == "" {
		return options{}, usageError{errors.New("page URL must not be empty")}
	}
	if *pageSize <= 0 {
		return options{}, usageError{fmt.Errorf("page size must be positive, got %d", *pageSize)}
	}
	if *concurrency <= 0 {
		return options{}, usageError{fmt.Errorf("concurrency must be positive, got %d", *concurrency)}
	}
	if *maxPages <= 0 {
		return options{}, usageError{fmt.Errorf("max pages must be positive, got %d", *maxPages)}
	}
	if *baseURL != "" {
		parsed, err := url.Parse(*baseURL)
		if err != nil {
			return options{}, usageError{fmt.Errorf("parse base URL: %w", err)}
		}
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return options{}, usageError{fmt.Errorf("base URL scheme must be http or https, got %q", parsed.Scheme)}
		}
	}

	variants, err := marketdata.SelectVariants(*market, *securityType, *index)
	if err != nil {
		return options{}, usageError{err}
	}

	format, err := export.ParseFormat(*formatArg)
	if err != nil {
		return options{}, usageError{err}
	}

	return options{
		outDir:         *outDir,
		market:         *market,
		securityType:   *securityType,
		index:          *index,
		pageSize:       *pageSize,
		concurrency:    *concurrency,
		format:         format,
		pageURL:        *pageURL,
		baseURL:        *baseURL,
		apiKey:         *apiKey,
		requestTimeout: *requestTimeout,
		maxPages:       *maxPages,
		list:           *list,
		showVersion:    *showVersion,
		variants:       variants,
	}, nil
}

func run(ctx context.Context, opts options, stdout, stderr io.Writer) error {
	if opts.list {
		for _, variant := range opts.variants {
			writeFormat(stdout, "%-14s %s\n", variant.Slug(), variant.Label())
		}
		return nil
	}

	if opts.dashboard {
		return runDashboard(ctx, opts, stdout, stderr)
	}

	bootstrap, err := discover(ctx, opts)
	if err != nil {
		return err
	}

	source, err := marketdata.NewClient(
		bootstrap.BaseURL,
		bootstrap.APIKey,
		marketdata.WithPageSize(opts.pageSize),
		marketdata.WithMaxPages(opts.maxPages),
		marketdata.WithHTTPClient(&http.Client{Timeout: opts.requestTimeout}),
	)
	if err != nil {
		return fmt.Errorf("create market data client: %w", err)
	}

	writer := export.NewWriter(opts.format)

	report := func(result crawler.Result) {
		if result.Err != nil {
			writeFormat(stderr, "FAIL %-14s %v\n", result.Variant.Slug(), result.Err)
			return
		}
		writeFormat(stderr, "ok   %-14s %5d rows  %s\n", result.Variant.Slug(), result.Quotes, result.Path)
	}

	engine, err := crawler.New(
		source,
		writer,
		opts.outDir,
		crawler.WithConcurrency(opts.concurrency),
		crawler.WithReporter(report),
	)
	if err != nil {
		return fmt.Errorf("create crawler: %w", err)
	}

	results := engine.Run(ctx, opts.variants)

	var failed, rows int
	for _, result := range results {
		if result.Err != nil {
			failed++
			continue
		}
		rows += result.Quotes
	}

	writeFormat(stdout, "wrote %d/%d files (%d rows) to %s\n", len(results)-failed, len(opts.variants), rows, opts.outDir)

	if len(results) < len(opts.variants) {
		return fmt.Errorf("crawl interrupted after %d of %d variants", len(results), len(opts.variants))
	}
	if failed > 0 {
		return fmt.Errorf("%d of %d variants failed", failed, len(opts.variants))
	}

	return nil
}

func runDashboard(ctx context.Context, opts options, stdout, stderr io.Writer) error {
	client, err := brapi.NewClient(
		brapi.WithBaseURL(opts.brapiBaseURL),
		brapi.WithHTTPClient(&http.Client{Timeout: opts.requestTimeout}),
	)
	if err != nil {
		return fmt.Errorf("create brapi client: %w", err)
	}

	builder, err := dashboard.NewBuilder(client, dashboard.WithLimit(opts.dashboardLimit))
	if err != nil {
		return fmt.Errorf("create dashboard builder: %w", err)
	}

	snapshot, err := builder.Build(ctx)
	if err != nil {
		return fmt.Errorf("build dashboard: %w", err)
	}

	path := filepath.Join(opts.outDir, "latest.json")
	if err := dashboard.Write(ctx, path, snapshot); err != nil {
		return fmt.Errorf("write dashboard: %w", err)
	}

	var failed int
	for _, group := range snapshot.Groups {
		if group.Error != "" {
			failed++
			writeFormat(stderr, "warn %-6s %s\n", group.Key, group.Error)
			continue
		}
		writeFormat(stderr, "ok   %-6s %d items\n", group.Key, len(group.Items))
	}

	writeFormat(stdout, "wrote %s (%d groups, %d failed, %s)\n",
		path, len(snapshot.Groups), failed, snapshot.GeneratedAt.Format(time.RFC3339))

	return nil
}

func discover(ctx context.Context, opts options) (marketdata.Bootstrap, error) {
	if opts.baseURL != "" && opts.apiKey != "" {
		return marketdata.Bootstrap{BaseURL: opts.baseURL, APIKey: opts.apiKey}, nil
	}

	client := &http.Client{Timeout: opts.requestTimeout}

	bootstrap, err := marketdata.Discover(ctx, client, opts.pageURL)
	if err != nil {
		return marketdata.Bootstrap{}, fmt.Errorf("discover API configuration: %w", err)
	}

	if opts.baseURL != "" {
		bootstrap.BaseURL = opts.baseURL
	}
	if opts.apiKey != "" {
		bootstrap.APIKey = opts.apiKey
	}

	return bootstrap, nil
}

func writeLine(w io.Writer, args ...any) {
	_, _ = fmt.Fprintln(w, args...)
}

func writeFormat(w io.Writer, format string, args ...any) {
	_, _ = fmt.Fprintf(w, format, args...)
}
