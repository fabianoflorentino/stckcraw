package export_test

import (
	"context"
	"encoding/csv"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/fabianoflorentino/stckcraw/internal/export"
	"github.com/fabianoflorentino/stckcraw/internal/marketdata"
)

func TestFormatterSiteRow(t *testing.T) {
	t.Parallel()

	location := time.FixedZone("BRT", -3*60*60)
	now := time.Date(2026, 10, 28, 18, 0, 0, 0, location)
	formatter := export.NewFormatter(
		export.FormatSite,
		export.WithLocation(location),
		export.WithClock(func() time.Time { return now }),
	)

	quote := marketdata.Quote{
		Symbol:          "PETR4",
		TradeDate:       "2026-10-28T15:53:00-03:00",
		Price:           ptr(38.5),
		Change:          ptr(1.234),
		ChangeMonth:     ptr(-1.2),
		ChangeYear:      ptr(0),
		Change52W:       ptr(12.3),
		Low:             ptr(37.999),
		High:            ptr(39.1),
		FinancialVolume: ptr(1_234_567_890),
	}

	want := []string{"PETR4", "15h53", "38,50", "+1,23%", "-1,20%", "0,00%", "+12,30%", "37,99", "39,10", "1.2B"}
	if got := formatter.Row(quote); !reflect.DeepEqual(got, want) {
		t.Errorf("Row() = %v, want %v", got, want)
	}
}

func TestFormatterSiteRowOlderDate(t *testing.T) {
	t.Parallel()

	location := time.FixedZone("BRT", -3*60*60)
	now := time.Date(2026, 10, 28, 18, 0, 0, 0, location)
	formatter := export.NewFormatter(
		export.FormatSite,
		export.WithLocation(location),
		export.WithClock(func() time.Time { return now }),
	)

	quote := marketdata.Quote{Symbol: "VALE3", TradeDate: "2026-10-27T10:00:00-03:00"}
	row := formatter.Row(quote)
	if row[1] != "27/10" {
		t.Errorf("date = %q, want 27/10", row[1])
	}
	for _, value := range row[2:] {
		if value != "-" {
			t.Errorf("nil value = %q, want -", value)
		}
	}
}

func TestFormatterRawRow(t *testing.T) {
	t.Parallel()

	formatter := export.NewFormatter(export.FormatRaw)
	quote := marketdata.Quote{
		Symbol:    "PETR4",
		TradeDate: "2026-10-28T15:53:00-03:00",
		Price:     ptr(38.5),
		Change:    ptr(1.234),
	}

	want := []string{"PETR4", "2026-10-28T15:53:00-03:00", "38.5", "1.234", "", "", "", "", "", ""}
	if got := formatter.Row(quote); !reflect.DeepEqual(got, want) {
		t.Errorf("Row() = %v, want %v", got, want)
	}
}

func TestWriterWritesCSV(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "nested", "b3_ibov.csv")
	writer := export.NewWriter(export.FormatRaw)
	quotes := []marketdata.Quote{
		{Symbol: "PETR4", TradeDate: "2026-10-28", Price: ptr(38.5)},
		{Symbol: "VALE3", TradeDate: "2026-10-28"},
	}

	if err := writer.Write(context.Background(), path, quotes); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	file, err := os.Open(path)
	if err != nil {
		t.Fatalf("open output: %v", err)
	}
	defer func() {
		if err := file.Close(); err != nil {
			t.Errorf("close output: %v", err)
		}
	}()

	records, err := csv.NewReader(file).ReadAll()
	if err != nil {
		t.Fatalf("read output: %v", err)
	}
	if len(records) != 3 {
		t.Fatalf("records = %d, want 3", len(records))
	}
	if records[0][0] != "Ativo" || records[0][9] != "Volume" {
		t.Errorf("unexpected header: %v", records[0])
	}
	if records[1][0] != "PETR4" || records[1][2] != "38.5" {
		t.Errorf("unexpected first row: %v", records[1])
	}
	if records[2][0] != "VALE3" || records[2][2] != "" {
		t.Errorf("unexpected second row: %v", records[2])
	}
}

func TestWriterHonorsCancellation(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	path := filepath.Join(t.TempDir(), "b3_ibov.csv")
	writer := export.NewWriter(export.FormatRaw)

	err := writer.Write(ctx, path, nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Write() error = %v, want context.Canceled", err)
	}
}

func TestParseFormat(t *testing.T) {
	t.Parallel()

	tests := []struct {
		input   string
		want    export.Format
		wantErr bool
	}{
		{input: "site", want: export.FormatSite},
		{input: "raw", want: export.FormatRaw},
		{input: "cru", want: export.FormatRaw},
		{input: "", want: export.FormatSite},
		{input: "xml", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.input, func(t *testing.T) {
			t.Parallel()

			got, err := export.ParseFormat(test.input)
			if test.wantErr {
				if err == nil {
					t.Fatal("ParseFormat() error = nil, want error")
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseFormat() error = %v", err)
			}
			if got != test.want {
				t.Errorf("ParseFormat() = %v, want %v", got, test.want)
			}
		})
	}
}

func ptr(value float64) *float64 { return &value }
