#!/usr/bin/env bash
# One-time (and safely re-runnable) setup of barakahstore.org on the shared VM.
# Copy deploy/vm to the VM, then:  ssh -t arefin@<vm> 'sudo bash ~/barakah-deploy/setup.sh'
#
# Never overwrites /opt/barakah/.env or app.env once written, never touches the mediguideapp.com
# site, and never deletes data. See RUNBOOK.md for the steps around it (DNS, GitHub secrets).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo." >&2; exit 1; fi
DEPLOY_USER="${SUDO_USER:-arefin}"
SRC="$(cd "$(dirname "$0")" && pwd)"
APP_DIR=/opt/barakah
DOMAIN=barakahstore.org
SITE=/etc/nginx/sites-available/barakahstore

echo "== Docker"
if ! command -v docker >/dev/null; then
  apt-get update
  apt-get install -y docker.io docker-compose-v2
fi
systemctl enable --now docker
if [ ! -f /etc/docker/daemon.json ]; then
  # Bounded container logs: the disk is shared with mediguideapp.com. Restarting the daemon to
  # apply this happens only here, on first setup, before any Barakah container exists.
  printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "3" }\n}\n' > /etc/docker/daemon.json
  systemctl restart docker
fi
usermod -aG docker "$DEPLOY_USER"

echo "== $APP_DIR"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 750 "$APP_DIR" "$APP_DIR/postgres-init"
install -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 640 "$SRC/docker-compose.yml" "$APP_DIR/"
install -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 750 "$SRC/deploy.sh" "$APP_DIR/"
install -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 755 "$SRC/postgres-init/01-roles.sh" "$APP_DIR/postgres-init/"

if [ ! -f "$APP_DIR/.env" ]; then
  app_db_password="$(openssl rand -hex 24)"
  umask 077
  cat > "$APP_DIR/.env" <<ENV
# Compose interpolation for /opt/barakah. deploy.sh rewrites BARAKAH_IMAGE on every deploy.
BARAKAH_IMAGE=ghcr.io/araf488/barakah_bazaar:prod
POSTGRES_PASSWORD=$(openssl rand -hex 24)
APP_DB_PASSWORD=$app_db_password
ENV
  sed -e "s|__APP_DB_PASSWORD__|$app_db_password|" \
      -e "s|__JWT_SECRET__|$(openssl rand -hex 32)|" \
      -e "s|__TOTP_ENCRYPTION_KEY__|$(openssl rand -base64 32)|" \
      "$SRC/app.env.template" > "$APP_DIR/app.env"
  umask 022
  chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR/.env" "$APP_DIR/app.env"
  chmod 600 "$APP_DIR/.env" "$APP_DIR/app.env"
  echo "Wrote $APP_DIR/.env and $APP_DIR/app.env with fresh secrets."
else
  echo "$APP_DIR/.env exists; secrets left as they are."
fi

echo "== Postgres"
(cd "$APP_DIR" && sudo -u "$DEPLOY_USER" -g docker docker compose up -d postgres)

echo "== Database backups"
install -m 755 "$SRC/db-backup.sh" /usr/local/bin/barakah-db-backup
install -m 644 "$SRC/systemd/barakah-db-backup.service" "$SRC/systemd/barakah-db-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now barakah-db-backup.timer

echo "== nginx"
if [ ! -f "$SITE" ]; then
  install -m 644 "$SRC/nginx/barakahstore.conf" "$SITE"
fi
ln -sf "$SITE" /etc/nginx/sites-enabled/barakahstore
nginx -t
systemctl reload nginx

echo "== TLS"
if grep -q "managed by Certbot" "$SITE"; then
  echo "Certificate already installed for $DOMAIN."
elif certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --redirect --non-interactive --agree-tos; then
  echo "Certificate installed for $DOMAIN."
else
  echo "certbot failed. Point $DOMAIN and www.$DOMAIN at this VM in Cloudflare (RUNBOOK step 1),"
  echo "then run: sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --redirect"
fi

cat <<NEXT

Done on the VM. Remaining (RUNBOOK.md):
  * Log out and back in once, so $DEPLOY_USER can use docker without sudo.
  * GitHub > Settings > Environments > prod: add the secrets listed in RUNBOOK step 4.
    DIRECT_URL is postgresql://barakah_app:<APP_DB_PASSWORD>@127.0.0.1:15432/barakah?schema=public
    (read the password with: grep APP_DB_PASSWORD $APP_DIR/.env).
  * Push to main; CI ships the image, migrates and starts the app.
NEXT
