#!/usr/bin/env bash
# Get the latest version of the site from GitHub and restart it.
#   bash ~/mbs-website/deploy/update.sh
set -euo pipefail
APP="$HOME/mbs-website"
BRANCH="${BRANCH:-$(git -C "$APP" rev-parse --abbrev-ref HEAD)}"
cd "$APP"
bash "$APP/deploy/backup.sh" >/dev/null 2>&1 || true          # a backup first, just in case
git fetch -q origin
git checkout -q "$BRANCH"
git pull --ff-only origin "$BRANCH"
chmod +x deploy/*.sh
sudo systemctl restart mbs-website
sleep 3
if curl -fs -o /dev/null http://127.0.0.1:8888/; then
  echo "Updated and running: $(git log -1 --format='%h %s')"
else
  echo "The site did not answer after the update. Recent messages:"
  sudo journalctl -u mbs-website -n 30 --no-pager
fi
