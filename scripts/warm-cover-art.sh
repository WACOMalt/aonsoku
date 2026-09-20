#!/usr/bin/env bash
#
# Pre-generate every cover art thumbnail on a Subsonic/Navidrome server.
#
# The server resizes artwork on demand and caches the result, so the first
# request for a given cover and size is slow and later ones are fast. This
# walks the whole library once so browsing never pays that cost.
#
# Run it after raising the server's image cache (Navidrome: ND_IMAGECACHESIZE),
# otherwise early entries are evicted before they do any good.
#
# Usage:
#   AONSOKU_WARM_PASSWORD=secret \
#     ./scripts/warm-cover-art.sh --url https://music.example.com --user NAME
#
# Options:
#   --url URL           server base URL (required)
#   --user NAME         username (required)
#   --concurrency N     parallel requests, default 2; keep low on weak hardware
#   --sizes "A B C"     pixel sizes, default "128 300 512 768"
#   --dry-run           list what would be fetched, then stop

set -euo pipefail

SERVER_URL=""
USERNAME=""
CONCURRENCY=2
SIZES="128 300 512 768"
DRY_RUN=false
CLIENT="aonsoku-warm"
API_VERSION="1.16.1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) SERVER_URL="${2:-}"; shift 2 ;;
    --user) USERNAME="${2:-}"; shift 2 ;;
    --concurrency) CONCURRENCY="${2:-}"; shift 2 ;;
    --sizes) SIZES="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) sed -n '3,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$SERVER_URL" ]] || { echo "Missing --url" >&2; exit 1; }
[[ -n "$USERNAME" ]] || { echo "Missing --user" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

PASSWORD="${AONSOKU_WARM_PASSWORD:-}"
if [[ -z "$PASSWORD" ]]; then
  read -r -s -p "Password for $USERNAME: " PASSWORD
  echo
fi

SERVER_URL="${SERVER_URL%/}"

# Calls a Subsonic endpoint. First argument is the endpoint, the rest are
# extra "key=value" pairs which are URL-encoded individually.
api() {
  local endpoint="$1"; shift
  local args=(
    --data-urlencode "u=$USERNAME"
    --data-urlencode "p=$PASSWORD"
    --data-urlencode "v=$API_VERSION"
    --data-urlencode "c=$CLIENT"
    --data-urlencode "f=json"
  )
  local pair
  for pair in "$@"; do args+=(--data-urlencode "$pair"); done
  curl -fsS --get "${args[@]}" "$SERVER_URL/rest/$endpoint"
}

echo "Checking connection to $SERVER_URL ..."
api "ping.view" | grep -q '"status":"ok"' || {
  echo "Could not authenticate against $SERVER_URL" >&2
  exit 1
}

ID_FILE="$(mktemp)"
trap 'rm -f "$ID_FILE"' EXIT

echo "Collecting cover art ids ..."
PAGE_SIZE=500
offset=0
while :; do
  page="$(api "getAlbumList2.view" "type=alphabeticalByName" \
    "size=$PAGE_SIZE" "offset=$offset")"

  found="$(printf '%s' "$page" | python3 -c '
import sys, json
albums = json.load(sys.stdin)["subsonic-response"].get("albumList2", {}).get("album", [])
ids = [a["coverArt"] for a in albums if a.get("coverArt")]
sys.stderr.write("\n".join(ids) + ("\n" if ids else ""))
print(len(albums))
' 2>>"$ID_FILE")"

  offset=$((offset + found))
  printf '  albums scanned: %d\r' "$offset"
  [[ "$found" -lt "$PAGE_SIZE" ]] && break
done
echo

api "getArtists.view" | python3 -c '
import sys, json
index = json.load(sys.stdin)["subsonic-response"].get("artists", {}).get("index", [])
for group in index:
    for artist in group.get("artist", []):
        if artist.get("coverArt"):
            print(artist["coverArt"])
' >>"$ID_FILE"

sort -u -o "$ID_FILE" "$ID_FILE"
TOTAL_IDS="$(wc -l <"$ID_FILE" | tr -d ' ')"
SIZE_COUNT="$(wc -w <<<"$SIZES" | tr -d ' ')"
TOTAL=$((TOTAL_IDS * SIZE_COUNT))

echo "Found $TOTAL_IDS covers x $SIZE_COUNT sizes = $TOTAL requests"

if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run, stopping here. Sizes: $SIZES"
  exit 0
fi

echo "Concurrency $CONCURRENCY. This is deliberately slow; leave it running."

warm_one() {
  curl -fsS -o /dev/null --max-time 180 --get \
    --data-urlencode "u=$USERNAME" \
    --data-urlencode "p=$PASSWORD" \
    --data-urlencode "v=$API_VERSION" \
    --data-urlencode "c=$CLIENT" \
    --data-urlencode "id=$1" \
    --data-urlencode "size=$2" \
    "$SERVER_URL/rest/getCoverArt.view" \
    || echo "  failed: $1 @ $2" >&2
}

done_count=0
started="$(date +%s)"
while IFS= read -r art_id; do
  [[ -n "$art_id" ]] || continue
  for size in $SIZES; do
    warm_one "$art_id" "$size" &
    while [[ "$(jobs -rp | wc -l)" -ge "$CONCURRENCY" ]]; do wait -n; done
    done_count=$((done_count + 1))
    if (( done_count % 100 == 0 )); then
      elapsed=$(( $(date +%s) - started ))
      printf '  %d/%d  (%ds elapsed)\n' "$done_count" "$TOTAL" "$elapsed"
    fi
  done
done <"$ID_FILE"
wait

elapsed=$(( $(date +%s) - started ))
echo "Done. $TOTAL requests in ${elapsed}s."
