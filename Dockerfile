# syntax=docker/dockerfile:1

FROM golang:1.27-alpine AS build

WORKDIR /src

COPY go.mod ./
RUN go mod download

COPY . .

ARG VERSION=docker
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags "-s -w -X github.com/fabianoflorentino/stckcraw/internal/cli.Version=${VERSION}" \
    -o /out/stckcraw ./cmd/stckcraw

FROM alpine:3.22

RUN addgroup -S app \
    && adduser -S -G app -u 10001 app

COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/stckcraw /usr/local/bin/stckcraw
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /data \
    && chown -R app:app /data

USER app

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["-dashboard", "-out", "/data", "-limit", "10"]
