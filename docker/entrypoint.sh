#!/bin/sh
set -eu

interval="${UPDATE_INTERVAL:-1800}"

case "$interval" in
  ''|*[!0-9]*|0)
    echo "[stckcraw] invalid UPDATE_INTERVAL: ${interval}" >&2
    exit 1
    ;;
esac

log() {
  echo "[stckcraw] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"
}

trap 'log "shutting down"; exit 0' TERM INT

log "dashboard updater starting (interval=${interval}s)"

while true; do
  log "updating dashboard"
  if /usr/local/bin/stckcraw "$@"; then
    log "update ok"
  else
    log "update failed; keeping previous snapshot"
  fi

  now="$(date +%s)"
  next=$(( (now / interval + 1) * interval ))
  delay=$(( next - now ))

  log "next update in ${delay}s"
  sleep "${delay}" &
  wait $! || true
done
