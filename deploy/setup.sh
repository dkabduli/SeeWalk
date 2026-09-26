#!/usr/bin/env bash
# One-time setup of a fresh Vultr Ubuntu 24.04 server for SeeWalk (run as root).
#
#   ssh root@<ip> 'bash -s -- <your-domain> [branch]' < deploy/setup.sh     (domain can be "" for now)
#
# Serves the built web app + /api/* (FastAPI) over HTTPS with Caddy. Works before the domain
# is set up too: https://<ip-with-dashes>.sslip.io gets a real certificate right away.
set -euo pipefail

DOMAIN="${1:-}"
BRANCH="${2:-main}"
REPO="https://github.com/dkabduli/SeeWalk.git"
DIR=/srv/seewalk

IP=$(curl -fsS https://api.ipify.org)
SSLIP="$(echo "$IP" | tr . -).sslip.io"
SITES="$SSLIP${DOMAIN:+, $DOMAIN}"
echo "==> Setting up SeeWalk for: $SITES (branch $BRANCH)"

# Small plans have 1 GB RAM: add swap so the web build doesn't run out of memory
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq git curl ca-certificates python3-venv caddy ufw
# Vite 8 needs Node 20.19+; Ubuntu's apt Node is too old
if ! node --version 2>/dev/null | grep -q '^v2[2-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -yq nodejs
fi

id seewalk &>/dev/null || useradd --system --create-home --shell /usr/sbin/nologin seewalk
if [ ! -d "$DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO" "$DIR"
fi
chown -R seewalk:seewalk "$DIR"

# Which FastAPI app to run. Switch to main:app once Aroha's main.py serves /analyze + /tts.
mkdir -p /etc/seewalk
[ -f /etc/seewalk/app.env ] || echo "SEEWALK_APP=listen_app:app" > /etc/seewalk/app.env

cat > /etc/systemd/system/seewalk-api.service <<EOF
[Unit]
Description=SeeWalk API (FastAPI)
After=network-online.target

[Service]
User=seewalk
WorkingDirectory=$DIR/server
EnvironmentFile=/etc/seewalk/app.env
ExecStart=$DIR/server/.venv/bin/uvicorn \${SEEWALK_APP} --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
$SITES {
	encode gzip
	handle_path /api/* {
		reverse_proxy 127.0.0.1:8000
	}
	handle {
		root * $DIR/web/dist
		try_files {path} /index.html
		file_server
	}
}
EOF

ufw allow OpenSSH >/dev/null && ufw allow 80 >/dev/null && ufw allow 443 >/dev/null && ufw --force enable >/dev/null

systemctl daemon-reload
systemctl enable seewalk-api caddy >/dev/null
bash "$DIR/deploy/update.sh"

echo
echo "==> Done. Open https://$SSLIP${DOMAIN:+ (and https://$DOMAIN once its DNS points at $IP)}"
[ -f "$DIR/server/.env" ] || echo "==> Still needed: copy server/.env to $DIR/server/.env, then: systemctl restart seewalk-api"
