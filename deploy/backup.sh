#!/usr/bin/env bash
# Back up the enquiries database, photos and enquiry log. Keeps 30 days.
# Runs every night at 2am (set up by setup-server.sh). Run by hand any time:
#   bash ~/mbs-website/deploy/backup.sh
set -euo pipefail
APP="$HOME/mbs-website"
OUT="$HOME/mbs-backups"
mkdir -p "$OUT"
cd "$APP"
parts=()
for d in data leads; do [ -e "$d" ] && parts+=("$d"); done
[ -f .env ] && parts+=(".env")
if [ ${#parts[@]} -eq 0 ]; then echo "Nothing to back up yet."; exit 0; fi
FILE="$OUT/mbs-$(date +%Y-%m-%d_%H%M).tar.gz"
tar -czf "$FILE" "${parts[@]}"
chmod 600 "$FILE"
find "$OUT" -name 'mbs-*.tar.gz' -mtime +30 -delete
echo "Backup saved: $FILE"
