#!/usr/bin/env bash
# Is the site running? Shows the service state and the last messages.
#   bash ~/mbs-website/deploy/status.sh
systemctl --no-pager --lines=0 status mbs-website caddy | grep -E '●|Active:'
echo
if curl -fs -o /dev/null http://127.0.0.1:8888/; then echo "Site answers on the server: yes"; else echo "Site answers on the server: NO"; fi
echo
echo "Last 25 messages from the site:"
sudo journalctl -u mbs-website -n 25 --no-pager -o cat
