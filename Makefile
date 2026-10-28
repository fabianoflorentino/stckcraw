BINARY_NAME=stckcraw
GO=go
GOLANGCI_LINT?=golangci-lint
VERSION?=$(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS=-ldflags "-X github.com/fabianoflorentino/stckcraw/internal/cli.Version=$(VERSION)"

.PHONY: all build clean test test-short lint lint-fix fmt vet run download list dashboard preview docker-build docker-up docker-down docker-reset docker-logs help

all: clean lint test build

## build: Build the application
build:
	@echo "Building $(BINARY_NAME)..."
	$(GO) build $(LDFLAGS) -o bin/$(BINARY_NAME) ./cmd/stckcraw

## clean: Clean build artifacts
clean:
	@echo "Cleaning..."
	rm -rf bin/
	rm -f coverage.out coverage.html

## test: Run all tests
test:
	@echo "Running tests..."
	$(GO) test -race -coverprofile=coverage.out ./...
	$(GO) tool cover -html=coverage.out -o coverage.html

## test-short: Run tests without long-running ones
test-short:
	$(GO) test -short ./...

## lint: Run linter
lint:
	@echo "Running linter..."
	$(GOLANGCI_LINT) run ./...

## lint-fix: Run linter and auto-fix issues
lint-fix:
	@echo "Running linter with auto-fix..."
	$(GOLANGCI_LINT) run --fix ./...

## fmt: Format code and run vet
fmt:
	$(GO) fmt ./...
	$(GO) vet ./...

## vet: Run go vet
vet:
	$(GO) vet ./...

## run: Build and run the application
run: build
	./bin/$(BINARY_NAME)

## download: Download every supported leaderboard into ./data
download: build
	./bin/$(BINARY_NAME) -out data

## list: List all supported leaderboard variants
list: build
	./bin/$(BINARY_NAME) -list

## dashboard: Generate the dashboard JSON (docs/data/latest.json)
dashboard: build
	./bin/$(BINARY_NAME) -dashboard -out docs/data

## preview: Serve docs locally on http://localhost:8000
preview:
	python3 -m http.server -d docs 8000

## docker-build: Build the local dashboard image
docker-build:
	docker compose build

## docker-up: Run the local 30-minute dashboard on http://localhost:8080
docker-up:
	docker compose up --build -d

## docker-down: Stop the local dashboard stack
docker-down:
	docker compose down

## docker-reset: Stop the stack and remove the data volume
docker-reset:
	docker compose down -v

## docker-logs: Follow the dashboard updater logs
docker-logs:
	docker compose logs -f dashboard

## help: Show this help message
help:
	@echo "Usage: make [target]"
	@sed -n 's/^##//p' $(MAKEFILE_LIST) | column -t -s ':' | sed -e 's/^/ /'
