#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js is not installed. Download it from https://nodejs.org"; read -r -p "Press Enter to close"; exit 1; }
node --env-file=.env tools/check-setup.mjs
read -r -p "Press Enter to close"
