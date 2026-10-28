package marketdata_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/fabianoflorentino/stckcraw/internal/marketdata"
)

func TestDiscoverFromInlineConfig(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, err := fmt.Fprint(w, `<html><script>
window.InfoMoneyPage = {"api_marketdata":{"base_api_marketdata":"https://api.example.com/v1/","ocp_apim_subscription_key":"secret"},"other":true};
</script></html>`)
		if err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	defer server.Close()

	bootstrap, err := marketdata.Discover(context.Background(), server.Client(), server.URL)
	if err != nil {
		t.Fatalf("Discover() error = %v", err)
	}
	if bootstrap.BaseURL != "https://api.example.com/v1/" {
		t.Errorf("BaseURL = %q", bootstrap.BaseURL)
	}
	if bootstrap.APIKey != "secret" {
		t.Errorf("APIKey = %q", bootstrap.APIKey)
	}
}

func TestDiscoverFallbackPattern(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, err := fmt.Fprint(w, `<html>"api_marketdata":{"base_api_marketdata":"https:\/\/api.example.com\/v1\/","ocp_apim_subscription_key":"secret"}</html>`)
		if err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	defer server.Close()

	bootstrap, err := marketdata.Discover(context.Background(), server.Client(), server.URL)
	if err != nil {
		t.Fatalf("Discover() error = %v", err)
	}
	if bootstrap.BaseURL != "https://api.example.com/v1/" {
		t.Errorf("BaseURL = %q", bootstrap.BaseURL)
	}
	if bootstrap.APIKey != "secret" {
		t.Errorf("APIKey = %q", bootstrap.APIKey)
	}
}

func TestDiscoverMissingConfig(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, err := fmt.Fprint(w, `<html>nothing here</html>`)
		if err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	defer server.Close()

	_, err := marketdata.Discover(context.Background(), server.Client(), server.URL)
	if !errors.Is(err, marketdata.ErrConfigNotFound) {
		t.Fatalf("Discover() error = %v, want ErrConfigNotFound", err)
	}
}

func TestDiscoverHTTPError(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()

	if _, err := marketdata.Discover(context.Background(), server.Client(), server.URL); err == nil {
		t.Fatal("Discover() error = nil, want error")
	}
}
