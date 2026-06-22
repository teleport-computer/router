#!/usr/bin/env bash
#
# One-time EC2 bootstrap for Teamwork.
#
# What it does (safe to re-run):
#   1. Install system packages: Node 20, git, Nginx, PM2, psql client
#   2. Ensure ~/app points at the repo
#   3. Build both server and web
#   4. Initialize PostgreSQL schema on RDS (idempotent — uses CREATE TABLE IF NOT EXISTS)
#   5. Install Nginx config and reload
#   6. Register PM2 apps and enable autostart on boot
#
# What it does NOT do:
#   - Create server/.env (you copy it manually, it has secrets)
#   - Configure GitHub deploy key (manual step, see docs/DEPLOYMENT.md)
#   - Open AWS security group ports (manual, in AWS console)
#
# Usage (on EC2, as the application user):
#   curl -fsSL https://raw.githubusercontent.com/.../deploy/bootstrap.sh | bash
#   # or, after first clone:
#   bash ~/app/deploy/bootstrap.sh

set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/app}"
REPO_URL="${REPO_URL:-git@github.com:teleport-computer/router.git}"
BRANCH="${BRANCH:-main}"
NODE_MAJOR=20

log() { echo "→ $*"; }
ok()  { echo "✓ $*"; }

# ── 1. System packages ──────────────────────────────────────────
install_system_packages() {
  if command -v node >/dev/null && [[ "$(node -v)" == v${NODE_MAJOR}.* ]]; then
    ok "Node.js ${NODE_MAJOR} already installed"
  else
    log "Installing Node.js ${NODE_MAJOR}"
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi

  for pkg in git nginx postgresql-client; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
      log "Installing $pkg"
      sudo apt-get install -y "$pkg"
    else
      ok "$pkg already installed"
    fi
  done

  if ! command -v pm2 >/dev/null; then
    log "Installing PM2"
    sudo npm install -g pm2
  else
    ok "PM2 already installed"
  fi
}

# ── 2. Source code ──────────────────────────────────────────────
sync_repo() {
  if [[ ! -d "$APP_DIR/.git" ]]; then
    log "Cloning $REPO_URL → $APP_DIR"
    git clone "$REPO_URL" "$APP_DIR"
  else
    log "Pulling latest on branch $BRANCH"
    git -C "$APP_DIR" fetch origin "$BRANCH"
    git -C "$APP_DIR" checkout "$BRANCH"
    git -C "$APP_DIR" reset --hard "origin/$BRANCH"
  fi
  ok "Repo synced to $(git -C "$APP_DIR" rev-parse --short HEAD)"
}

# ── 3. Build ────────────────────────────────────────────────────
build_apps() {
  log "Building server"
  (cd "$APP_DIR/server" && npm install && npm run build)

  log "Building web"
  (cd "$APP_DIR/web" && npm install && npm run build)

  ok "Both apps built"
}

# ── 4. PostgreSQL schema ────────────────────────────────────────
init_schema() {
  if [[ ! -f "$APP_DIR/server/.env" ]]; then
    echo "!! Missing $APP_DIR/server/.env — skipping schema init."
    echo "   Copy .env from your local machine (with DATABASE_URL) then re-run:"
    echo "   bash $APP_DIR/deploy/bootstrap.sh init_schema"
    return 0
  fi

  # shellcheck disable=SC1090
  source "$APP_DIR/server/.env"

  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "!! DATABASE_URL not set in .env — skipping schema init."
    return 0
  fi

  # The Node pg library accepts sslmode=no-verify (encryption without CA
  # verification — needed for RDS self-signed certs), but psql's libpq does
  # NOT recognize that value. Translate the URL for psql only:
  #   - `sslmode=no-verify`  →  `sslmode=require` + PGSSLMODE=require env
  #   - anything else        →  pass through untouched
  local psql_url="$DATABASE_URL"
  if [[ "$psql_url" == *"sslmode=no-verify"* ]]; then
    psql_url="${psql_url//sslmode=no-verify/sslmode=require}"
    export PGSSLMODE=require
  fi

  log "Applying schema to $psql_url"
  psql "$psql_url" -v ON_ERROR_STOP=1 -f "$APP_DIR/server/src/schema.sql"
  ok "Schema applied (idempotent)"
}

# ── 5. Nginx ────────────────────────────────────────────────────
setup_nginx() {
  local src="$APP_DIR/deploy/nginx-teamwork.conf"
  local dst="/etc/nginx/sites-available/teamwork"

  log "Installing Nginx config"
  sudo cp "$src" "$dst"
  sudo ln -sf "$dst" /etc/nginx/sites-enabled/teamwork

  # Drop the default "Welcome to nginx" site if present.
  sudo rm -f /etc/nginx/sites-enabled/default

  sudo nginx -t
  sudo systemctl reload nginx
  ok "Nginx reloaded"
}

# ── 6. PM2 ──────────────────────────────────────────────────────
setup_pm2() {
  log "Starting PM2 apps"
  pm2 start "$APP_DIR/ecosystem.config.cjs" || pm2 reload "$APP_DIR/ecosystem.config.cjs"
  pm2 save

  if ! systemctl is-enabled pm2-"$USER" >/dev/null 2>&1; then
    log "Enabling PM2 startup on boot"
    # pm2 startup prints the command to run — execute it.
    sudo env PATH="$PATH:$(dirname "$(which node)")" pm2 startup systemd -u "$USER" --hp "$HOME"
    pm2 save
  fi
  ok "PM2 configured"
}

# ── Main ────────────────────────────────────────────────────────
main() {
  if [[ "$#" -gt 0 ]]; then
    "$1"
    exit 0
  fi

  install_system_packages
  sync_repo
  build_apps
  init_schema
  setup_nginx
  setup_pm2
  echo
  ok "Bootstrap complete. Visit http://<ec2-public-ip>/ to verify."
}

main "$@"
