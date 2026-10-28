package cli_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/fabianoflorentino/stckcraw/internal/cli"
	"github.com/fabianoflorentino/stckcraw/internal/dashboard"
)

func TestRunListAllVariants(t *testing.T) {
	t.Parallel()

	var stdout, stderr bytes.Buffer
	code := cli.Run(context.Background(), []string{"-list"}, &stdout, &stderr)
	if code != cli.ExitOK {
		t.Fatalf("Run() code = %d, stderr = %s", code, stderr.String())
	}
	if lines := nonEmptyLines(stdout.String()); len(lines) != 32 {
		t.Fatalf("listed %d variants, want 32", len(lines))
	}
}

func TestRunListB3Variants(t *testing.T) {
	t.Parallel()

	var stdout, stderr bytes.Buffer
	code := cli.Run(context.Background(), []string{"-list", "-market", "b3"}, &stdout, &stderr)
	if code != cli.ExitOK {
		t.Fatalf("Run() code = %d, stderr = %s", code, stderr.String())
	}
	if lines := nonEmptyLines(stdout.String()); len(lines) != 30 {
		t.Fatalf("listed %d variants, want 30", len(lines))
	}
}

func TestRunUsageError(t *testing.T) {
	t.Parallel()

	var stdout, stderr bytes.Buffer
	code := cli.Run(context.Background(), []string{"-market", "nasdaq", "-type", "acao"}, &stdout, &stderr)
	if code != cli.ExitUsage {
		t.Fatalf("Run() code = %d, want %d", code, cli.ExitUsage)
	}
	if !strings.Contains(stderr.String(), "only apply to b3") {
		t.Errorf("stderr = %q", stderr.String())
	}
}

func TestRunUnknownFlag(t *testing.T) {
	t.Parallel()

	var stdout, stderr bytes.Buffer
	code := cli.Run(context.Background(), []string{"-nope"}, &stdout, &stderr)
	if code != cli.ExitUsage {
		t.Fatalf("Run() code = %d, want %d", code, cli.ExitUsage)
	}
}

func TestRunVersion(t *testing.T) {
	t.Parallel()

	var stdout, stderr bytes.Buffer
	code := cli.Run(context.Background(), []string{"-version"}, &stdout, &stderr)
	if code != cli.ExitOK {
		t.Fatalf("Run() code = %d, stderr = %s", code, stderr.String())
	}
	want := "stckcraw " + cli.Version + "\n"
	if stdout.String() != want {
		t.Errorf("stdout = %q, want %q", stdout.String(), want)
	}
}

func TestRunEndToEnd(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/b3/quotes/intraday/leaderboard" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if got := r.URL.Query().Get("SecurityType"); got != "Quote" {
			t.Errorf("SecurityType = %q", got)
		}

		w.Header().Set("Content-Type", "application/json")
		if _, err := fmt.Fprint(w, `{"result":[
			{"symbol":"PETR4","tradeDate":"2026-10-28T15:00:00-03:00","price":38.5,"change":1.25,"changeMonth":2.5,"changeYear":3.75,"change52w":4.0,"low":37.9,"high":38.9,"financialVolume":123456789}
		],"pageInfo":{"hasNextPage":false}}`); err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	defer server.Close()

	outDir := t.TempDir()
	var stdout, stderr bytes.Buffer

	code := cli.Run(context.Background(), []string{
		"-market", "b3",
		"-type", "acao",
		"-base-url", server.URL,
		"-api-key", "test-key",
		"-out", outDir,
		"-format", "raw",
	}, &stdout, &stderr)
	if code != cli.ExitOK {
		t.Fatalf("Run() code = %d, stderr = %s", code, stderr.String())
	}

	data, err := os.ReadFile(filepath.Join(outDir, "b3_acao.csv"))
	if err != nil {
		t.Fatalf("read output: %v", err)
	}
	if !strings.Contains(string(data), "PETR4") {
		t.Errorf("output does not contain PETR4:\n%s", data)
	}
	if !strings.Contains(stdout.String(), "wrote 1/1 files") {
		t.Errorf("stdout = %q", stdout.String())
	}
}

func TestRunDashboardEndToEnd(t *testing.T) {
	t.Parallel()

	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/quote/list" {
			t.Errorf("path = %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		if _, err := fmt.Fprint(w, `{"stocks":[
			{"stock":"PETR4","name":"Petrobras","close":38.5,"change":1.25,"volume":1000,"market_cap":500000000000,"sector":"Energy","type":"stock","subType":"stock"}
		]}`); err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	defer server.Close()

	outDir := t.TempDir()
	var stdout, stderr bytes.Buffer

	code := cli.Run(context.Background(), []string{
		"-dashboard",
		"-brapi-base-url", server.URL,
		"-out", outDir,
		"-limit", "2",
	}, &stdout, &stderr)
	if code != cli.ExitOK {
		t.Fatalf("Run() code = %d, stderr = %s", code, stderr.String())
	}

	data, err := os.ReadFile(filepath.Join(outDir, "latest.json"))
	if err != nil {
		t.Fatalf("read output: %v", err)
	}

	var snapshot dashboard.Snapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		t.Fatalf("unmarshal output: %v", err)
	}
	if snapshot.Source != "brapi.dev" {
		t.Errorf("source = %q", snapshot.Source)
	}
	if len(snapshot.Groups) != 6 {
		t.Fatalf("groups = %d, want 6", len(snapshot.Groups))
	}
	if len(snapshot.Groups[0].Items) != 1 || snapshot.Groups[0].Items[0].Symbol != "PETR4" {
		t.Errorf("unexpected first group: %+v", snapshot.Groups[0])
	}
	if got := requests.Load(); got != 6 {
		t.Errorf("requests = %d, want 6", got)
	}
	if !strings.Contains(stdout.String(), "6 groups") {
		t.Errorf("stdout = %q", stdout.String())
	}
}

func TestRunDashboardListConflict(t *testing.T) {
	t.Parallel()

	var stdout, stderr bytes.Buffer
	code := cli.Run(context.Background(), []string{"-dashboard", "-list"}, &stdout, &stderr)
	if code != cli.ExitUsage {
		t.Fatalf("Run() code = %d, want %d", code, cli.ExitUsage)
	}
}

func nonEmptyLines(value string) []string {
	lines := strings.Split(strings.TrimSpace(value), "\n")
	filtered := make([]string, 0, len(lines))
	for _, line := range lines {
		if strings.TrimSpace(line) != "" {
			filtered = append(filtered, line)
		}
	}
	return filtered
}
