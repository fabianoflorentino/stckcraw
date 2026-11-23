# Changelog

All notable changes to stckcraw are documented here. The project is
continuously deployed from `main` and does not use semantic version tags yet,
so entries are grouped by the date the change landed.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 2026-11-23

### Added

- Interactive crosshair on daily charts: a guide line follows the pointer and
  shows the date, interpolated close and cumulative period change at the
  intersection.
- Wallet stars on search results and the chart header, so assets can be
  favorited without leaving the search or the chart.
- Project skill `stckcraw-dashboard-ui` documenting the dashboard UI
  conventions, i18n rules, validation steps and release ritual.

### Fixed

- GitHub Pages publishing now uploads the artifact in the `update` job and
  deploys it from a separate `deploy` job, avoiding the intermittent
  `Found 0 artifact(s)` failure caused by artifact API eventual consistency.

## 2026-11-20

### Added

- Site-wide PT-BR/EN-US language switch, with PT-BR as the default language,
  the preference saved in `localStorage`, locale-aware number/date formatting,
  translated dynamic content and a `data-i18n` translation layer.

## 2026-11-19

### Added

- Local wallet with watchlist and positions: quantity, average price, invested
  value, current value, profit/loss, allocation weight and totals.
- Ticker autocomplete in the wallet form, backed by the brapi search, with
  keyboard navigation and a click-to-add dropdown.
- Wallet JSON export/import, including quantities and average prices, plus
  shared `?carteira=PETR4,VALE3` links that import tickers as a watchlist.
- A visible note explaining that the wallet lives in `localStorage` and that
  export/import should be used for backup and restore.
- Worker endpoint `GET /quote?symbol=PETR4` returning name, price, change,
  timestamp and one month of daily points from Yahoo Finance, cached for five
  minutes.
- Compact quote strip in the hero for USD/BRL, EUR/BRL, gold, Brent, Bitcoin
  and S&P 500, with up/down/stable colors.
- Sliding indicator for the Altas/Baixas/Carteira switch, respecting
  `prefers-reduced-motion`.
- Translucent surfaces, layered shadows and a toolbar panel across the site.

### Changed

- Major index cards now show Ibovespa, Nasdaq, Euro Stoxx 50 and Shanghai;
  S&P 500 moved to the compact quote strip.
- `make run` now generates the dashboard snapshot (`make dashboard` path);
  the legacy InfoMoney/XP CSV mode remains available via `make download`.
- The crawler now makes ten Yahoo Finance quote requests (four major indices
  plus six compact quotes).

### Fixed

- Legacy InfoMoney/XP failures caused by HTTP 403 now print a hint pointing to
  the supported `-dashboard` mode.
- GitHub Pages re-runs no longer fail with duplicate `github-pages` artifacts;
  the artifact name includes the workflow attempt.

## 2026-11-07

### Added

- Interactive highlight cards: top gainer, top loser and top volume open the
  asset chart; the coverage card expands or collapses every category.

## 2026-11-06

### Added

- Brand lockup with favicon in the hero and footer.
- Split green/red chart favicon, app icons and web manifest.

## 2026-11-03

### Added

- Daily one-month charts for indices and assets, in native SVG.
- Asset search across the B3 with on-demand history for assets outside the
  snapshot.
- Smoothed chart modal opening/closing transitions and richer chart stats.
- Hero market particles, scroll reveal effects and a full-page market backdrop.

## 2026-11-02

### Added

- B3 holiday detection from the Ibovespa timestamp, used to label the last
  trading session and align the workflow schedule.

## 2026-10-30

### Fixed

- The frontend now checks for a newer snapshot every five minutes.

## 2026-10-29

### Added

- Major market index cards for Ibovespa, S&P 500, Euro Stoxx 50 and Shanghai.
- Browser fallback that queries brapi directly when the published snapshot is
  missing, stale or unavailable.
- Cloudflare cron dispatcher with structured observability and optional manual
  trigger.
- Static Cloudflare mirror and Pages snapshot proxy for generated data.
- Last-known-good index quotes when Yahoo Finance rate-limits a request.

## 2026-10-28

### Added

- Half-hourly B3 dashboard for stocks, FIIs, FIPs, ETFs, BDRs and units, with
  top 10 gainers and losers and a GitHub Pages deployment workflow.
- Biggest-losers view with an Altas/Baixas mode switch.
- Investment disclaimer in the hero.
- Collapsible asset groups, whole-header toggling and a back-to-top button.
- Docker stack that refreshes the dashboard every 30 minutes.
- README and Mermaid architecture guide.

### Changed

- Improved dashboard layout, refresh feedback and entrance animations.
- Workflow schedule restricted to weekdays during B3 market hours.

### Fixed

- GitHub Actions cache settings, action major updates and temporary scheduler
  heartbeat cleanup.
