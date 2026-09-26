#!/usr/bin/env bash
# Pull the latest code, rebuild, restart (run as root on the server).
#
#   ssh root@<ip> 'bash /srv/seewalk/deploy/update.sh'
set -euo pipefail
DIR=/srv/seewalk
as_app() { sudo -u seewalk -H "$@"; }

cd "$DIR"
as_app git pull --ff-only

echo "==> API"
# The secrets file is copied in by hand (never in git): only the app user may read it
[ -f server/.env ] && chown seewalk:seewalk server/.env && chmod 600 server/.env
[ -d server/.venv ] || as_app python3 -m venv server/.venv
as_app server/.venv/bin/pip install -q -r server/requirements.txt

echo "==> Web (production build, real API)"
cd web
as_app npm ci --no-audit --no-fund --loglevel=error
as_app env VITE_FRAME_INTERVAL_MS=1500 npm run build

systemctl restart seewalk-api
systemctl reload caddy || systemctl restart caddy
sleep 2
if curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then
  echo "==> API is up"
else
  echo "==> API is NOT up: journalctl -u seewalk-api -n 30   (missing server/.env or GEMINI_API_KEY?)"
fi
