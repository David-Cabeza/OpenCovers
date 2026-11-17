#!/usr/bin/env bash
# Runs the shipped apps/web/Caddyfile in Caddy, in front of a stub API, and reads the headers each site block
# sends (ADR-0017 section 1, C41). Needs Docker. Usage: bash scripts/check-caddy-widget.sh
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
caddyfile=${CADDYFILE:-$root/apps/web/Caddyfile}
name="oc-caddy-check-$$"
cleanup() {
  docker rm -f "$name-api" "$name-caddy" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$name" >/dev/null
# The stub answers like the API: the widget page carries its own per-venue frame-ancestors.
docker run -d --name "$name-api" --network "$name" --network-alias api node:22-slim node -e '
require("http").createServer((req, res) => {
  const headers = { "Content-Type": "text/plain" };
  if (req.url.startsWith("/w/")) {
    headers["Content-Security-Policy"] = "default-src '"'self'"'; frame-ancestors '"'self'"' https://casa.example";
  }
  res.writeHead(200, headers);
  res.end(`upstream xff=${req.headers["x-forwarded-for"]}`);
}).listen(3000)' >/dev/null
docker run -d --name "$name-caddy" --network "$name" --network-alias caddy \
  -e SITE_ADDRESS=http://staff.test -e WIDGET_ADDRESS=http://book.test \
  -v "$caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine >/dev/null
sleep 2

# Prints the status line, the headers and the body of one request through Caddy, a 404 included.
get() {
  docker exec "$name-api" node -e '
const [host, path] = process.argv.slice(1);
require("http").get({ host: "caddy", port: 80, path, headers: { Host: host, "X-Forwarded-For": "203.0.113.9" } }, (res) => {
  let body = "";
  res.on("data", (chunk) => (body += chunk));
  res.on("end", () => {
    console.log(`HTTP/1.1 ${res.statusCode}`);
    for (const [k, v] of Object.entries(res.headers)) console.log(`${k}: ${v}`);
    console.log(body);
  });
});' "$1" "$2"
}

failures=0
check() {
  local label=$1 pattern=$2 out=$3 want=$4
  if grep -qiE -- "$pattern" <<<"$out"; then found=yes; else found=no; fi
  if [ "$found" = "$want" ]; then echo "ok    $label"; else echo "FAIL  $label"; failures=$((failures + 1)); fi
}

out=$(get staff.test /w/pk_AAAAAAAAAAAAAAAAAAAAAA)
check "staff /w/*: 404" "HTTP/1.1 404" "$out" yes
check "staff /w/*: X-Frame-Options DENY" "X-Frame-Options: DENY" "$out" yes
check "staff /w/*: frame-ancestors 'none'" "Content-Security-Policy: .*frame-ancestors 'none'" "$out" yes
check "staff /w/*: never reaches the API" "upstream" "$out" no

out=$(get staff.test /v1/public/pk_AAAAAAAAAAAAAAAAAAAAAA)
check "staff /v1/*: X-Frame-Options DENY" "X-Frame-Options: DENY" "$out" yes
check "staff /v1/*: frame-ancestors 'none'" "frame-ancestors 'none'" "$out" yes

out=$(get book.test /w/pk_AAAAAAAAAAAAAAAAAAAAAA)
check "widget /w/*: 200 from the API" "upstream" "$out" yes
check "widget /w/*: no X-Frame-Options" "X-Frame-Options" "$out" no
check "widget /w/*: the API's frame-ancestors" "frame-ancestors 'self' https://casa.example" "$out" yes
check "widget /w/*: no frame-ancestors 'none'" "frame-ancestors 'none'" "$out" no
check "widget /w/*: client X-Forwarded-For replaced" "xff=203.0.113.9" "$out" no
check "widget: no Server header" "^ *Server:" "$out" no

out=$(get book.test /v1/public/pk_AAAAAAAAAAAAAAAAAAAAAA)
check "widget /v1/public/*: 200 from the API" "upstream" "$out" yes
check "widget /v1/public/*: frame-ancestors 'none'" "Content-Security-Policy: .*frame-ancestors 'none'" "$out" yes
check "widget /v1/public/*: no X-Frame-Options" "X-Frame-Options" "$out" no

for path in / /api/auth/get-session /v1/venues/x/reservations /index.html; do
  out=$(get book.test "$path")
  check "widget $path: 404, not proxied" "HTTP/1.1 404" "$out" yes
done

[ "$failures" -eq 0 ] && echo "all checks passed" || { echo "$failures check(s) failed"; exit 1; }
