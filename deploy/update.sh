#!/bin/sh
# One-command update for the VPS: pull, rebuild, restart, verify.
# Installed as /usr/local/bin/bjj-deploy; run that from anywhere on the VPS.
#
# Compose file discovery is broken on this host: a bare `docker compose` run
# from the project directory reports "no configuration file provided" even with
# compose.yaml present. Every compose call therefore names --project-directory
# and -f explicitly.
set -eu

APP_DIR=/opt/bjj-notes
COMPOSE="docker compose --project-directory $APP_DIR -f $APP_DIR/compose.yaml"

cd "$APP_DIR"

echo "==> Pulling"
before=$(git rev-parse --short HEAD)
git pull --ff-only
after=$(git rev-parse --short HEAD)
if [ "$before" = "$after" ]; then
	echo "    no new commits (at $after)"
else
	echo "    $before -> $after"
fi

echo "==> Building"
$COMPOSE build

echo "==> Restarting"
$COMPOSE up -d

# Each rebuild orphans the previous image; without this the 232G disk fills up
# over months of deploys.
echo "==> Pruning old images"
docker image prune -f >/dev/null

echo "==> Status"
$COMPOSE ps
echo
docker logs bjj-notes --tail 5 2>&1

echo
echo "==> Health"
curl -sS -o /dev/null -w "    https://bjj-notes.yitzshapiro.com -> %{http_code}\n" \
	--max-time 20 https://bjj-notes.yitzshapiro.com/ \
	|| echo "    site check FAILED"
