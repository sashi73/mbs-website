#!/usr/bin/env bash
# =============================================================================
#  MBS website: one-time setup on an Ubuntu server (Oracle Cloud Always Free).
#
#  Run it on the server, as the normal "ubuntu" user (not root):
#     bash setup-server.sh https://github.com/YOUR-USERNAME/mbs-website.git
#     bash setup-server.sh https://github.com/YOUR-USERNAME/mbs-website.git www.modernbuildingsolutions.com.au
#
#  1st argument: your GitHub repository (the address from the green Code button)
#  2nd argument (optional): your domain. Leave it out to test with the server's
#                IP address first; run the script again with the domain later.
#
#  What it does: installs Node.js, Git and Caddy (web server with free HTTPS),
#  opens the web ports, downloads the site from GitHub (branch MBS-FixIT-ver-21),
#  lets you paste your keys into .env, and starts the site as a service that
#  restarts by itself. Safe to run again: it only changes what is needed.
# =============================================================================
set -euo pipefail

REPO="${1:-}"
DOMAIN="${2:-}"
BRANCH="${BRANCH:-MBS-FixIT-ver-21}"
APP="$HOME/mbs-website"
PORT=8888
SERVICE=mbs-website

say()  { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;31m    ! %s\033[0m\n' "$*"; }

if [ "$(id -u)" -eq 0 ]; then echo "Run this as the normal user (ubuntu), not with sudo."; exit 1; fi
if [ -z "$REPO" ] && [ ! -d "$APP/.git" ]; then
  echo "Usage: bash setup-server.sh https://github.com/YOUR-USERNAME/mbs-website.git [your-domain]"
  exit 1
fi
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%%/*}"

# GitHub address -> SSH form, so the server can read a private repository with a deploy key
if [[ "$REPO" =~ ^https://github\.com/([^/]+)/([^/]+)$ ]]; then
  REPO_SSH="git@github.com:${BASH_REMATCH[1]}/${BASH_REMATCH[2]%.git}.git"
else
  REPO_SSH="$REPO"
fi

# -----------------------------------------------------------------------------
say "1/8  Updating Ubuntu and installing basic tools (a few minutes the first time)"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y -q
sudo apt-get upgrade -y -q
sudo apt-get install -y -q git curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https netfilter-persistent iptables-persistent
ok "basic tools ready"

# -----------------------------------------------------------------------------
say "2/8  Node.js (the site needs 22.5 or newer)"
need_node=1
if command -v node >/dev/null 2>&1; then
  v=$(node -p 'process.versions.node.split(".").map(Number).reduce((a,b,i)=>a+b*[1e6,1e3,1][i],0)')
  [ "$v" -ge 22005000 ] && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y -q nodejs
fi
ok "Node.js $(node --version)"

# -----------------------------------------------------------------------------
say "3/8  Caddy web server (adds HTTPS automatically)"
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y -q
  sudo apt-get install -y -q caddy
fi
ok "$(caddy version | head -1)"

# -----------------------------------------------------------------------------
say "4/8  Opening the web ports (80 and 443) in the server's own firewall"
for p in 80 443; do
  if ! sudo iptables -C INPUT -p tcp -m state --state NEW --dport "$p" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 1 -p tcp -m state --state NEW --dport "$p" -j ACCEPT
  fi
done
sudo netfilter-persistent save >/dev/null
ok "ports 80 and 443 open (remember the Oracle 'Security List' rules too, see README-SERVER.txt)"

# -----------------------------------------------------------------------------
say "5/8  Access to your GitHub repository"
if [ ! -d "$APP/.git" ]; then
  KEY="$HOME/.ssh/mbs_deploy"
  mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
  if [[ "$REPO_SSH" == git@github.com:* ]]; then
    [ -f "$KEY" ] || ssh-keygen -t ed25519 -N "" -C "mbs-server" -f "$KEY" >/dev/null
    grep -q "IdentityFile $KEY" "$HOME/.ssh/config" 2>/dev/null || printf 'Host github.com\n  IdentityFile %s\n  IdentitiesOnly yes\n' "$KEY" >> "$HOME/.ssh/config"
    chmod 600 "$HOME/.ssh/config"
    ssh-keyscan -t ed25519 github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null
    until git ls-remote "$REPO_SSH" >/dev/null 2>&1; do
      echo
      echo "  The server needs permission to read your private repository. In GitHub:"
      echo "    your repository > Settings > Deploy keys > Add deploy key"
      echo "    Title: MBS server     Key: paste the line below     (leave 'Allow write access' OFF)"
      echo
      echo "  $(cat "$KEY.pub")"
      echo
      read -r -p "  Press Enter once you have added it... " _
    done
  fi
  git clone --branch "$BRANCH" "$REPO_SSH" "$APP"
  ok "site downloaded to $APP (branch $BRANCH)"
else
  git -C "$APP" fetch -q origin && git -C "$APP" checkout -q "$BRANCH" && git -C "$APP" pull -q --ff-only origin "$BRANCH"
  ok "site updated from GitHub (branch $BRANCH)"
fi
cd "$APP"

# -----------------------------------------------------------------------------
say "6/8  Your keys (.env)"
set_env() {   # set_env KEY VALUE: change the line if it exists, add it if not
  if grep -q "^$1=" .env; then sed -i "s#^$1=.*#$1=$2#" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
if [ -n "$DOMAIN" ]; then ORIGIN="https://$DOMAIN"; else ORIGIN="*"; fi
if [ ! -f .env ] && [ -f "$HOME/mbs.env" ]; then
  # your PC's .env, copied up with scp as ~/mbs.env (see README-SERVER.txt step 6)
  mv "$HOME/mbs.env" .env
  sed -i 's/\r$//' .env                       # Windows line endings would break the keys
  chmod 600 .env
  set_env PORT "$PORT"; set_env HOST 127.0.0.1; set_env ALLOWED_ORIGIN "$ORIGIN"
  ok "your keys were taken from mbs.env (the copy of your PC's .env) and stored in $APP/.env"
elif [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  set_env PORT "$PORT"; set_env HOST 127.0.0.1; set_env ALLOWED_ORIGIN "$ORIGIN"
  echo
  echo "  Notepad-style editor opens next. On your PC, open your working .env, copy the"
  echo "  values after each = sign into the same lines here (LLM_API_KEY, TELEGRAM_..., RESEND_API_KEY,"
  echo "  AZURE_SPEECH_KEY ...). Keep PORT=$PORT and HOST=127.0.0.1."
  echo "  Save: Ctrl+O then Enter.  Close: Ctrl+X."
  read -r -p "  Press Enter to open the editor... " _
  nano .env
else
  chmod 600 .env
  sed -i 's/\r$//' .env
  set_env PORT "$PORT"; set_env HOST 127.0.0.1
  if [ -n "$DOMAIN" ]; then set_env ALLOWED_ORIGIN "$ORIGIN"; fi
  ok ".env already there (kept your keys)"
fi

# -----------------------------------------------------------------------------
say "7/8  Starting the site as a service (restarts by itself, starts after a reboot)"
NODE_BIN="$(command -v node)"
sudo tee /etc/systemd/system/$SERVICE.service >/dev/null <<EOF
[Unit]
Description=MBS website and Mr. Fixit
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$APP
ExecStart=$NODE_BIN --env-file=.env local-server.mjs
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable -q $SERVICE
sudo systemctl restart $SERVICE
sleep 3
if curl -fs -o /dev/null "http://127.0.0.1:$PORT/"; then ok "site running on the server"; else warn "the site did not answer; see: sudo journalctl -u $SERVICE -n 50"; fi

# nightly backup of enquiries and photos at 2am, keeping 30 days
chmod +x "$APP/deploy/"*.sh
( crontab -l 2>/dev/null | grep -v 'mbs-website/deploy/backup.sh' || true; echo "0 2 * * * bash $APP/deploy/backup.sh >/dev/null 2>&1" ) | crontab -
ok "nightly backup scheduled (into ~/mbs-backups)"

# -----------------------------------------------------------------------------
say "8/8  Web address and HTTPS (Caddy)"
if [ -n "$DOMAIN" ]; then
  if [[ "$DOMAIN" == www.* ]]; then BARE="${DOMAIN#www.}"; else BARE="$DOMAIN"; DOMAIN="www.$DOMAIN"; fi
  sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
# MBS website (written by deploy/setup-server.sh)
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}
$BARE {
	redir https://$DOMAIN{uri} permanent
}
EOF
  cd "$APP"; set_env ALLOWED_ORIGIN "https://$DOMAIN"; sudo systemctl restart $SERVICE
  ADDR="https://$DOMAIN"
else
  sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
# MBS website, test mode (by IP address, no HTTPS yet). Run setup-server.sh again with your domain.
:80 {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
  IP="$(curl -fs https://api.ipify.org || true)"
  ADDR="http://${IP:-YOUR-SERVER-IP}"
fi
sudo systemctl enable -q caddy
sudo systemctl reload caddy || sudo systemctl restart caddy
ok "Caddy configured"

echo
echo "  ============================================================"
echo "   Done. Open:  $ADDR"
if [ -n "$DOMAIN" ]; then echo "   (HTTPS can take a minute the first time, once the domain points here)"; fi
echo
echo "   Useful commands on the server:"
echo "     bash ~/mbs-website/deploy/update.sh      get the latest version from GitHub"
echo "     bash ~/mbs-website/deploy/status.sh      is it running? recent messages"
echo "     nano ~/mbs-website/.env                  change keys (then run update.sh)"
echo "  ============================================================"
