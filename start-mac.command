#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js is not installed. Download it from https://nodejs.org then run this again."; read -r -p "Press Enter to close"; exit 1; }
if [ ! -f .env ]; then cp .env.example .env; echo "Created .env. Add your keys, save, then run this again."; open -e .env; exit 0; fi
PORT=$(grep -E '^PORT=' .env | head -1 | cut -d= -f2 | tr -d '[:space:]'); PORT=${PORT:-8888}
(sleep 2; open "http://localhost:$PORT") &
node --env-file=.env local-server.mjs
