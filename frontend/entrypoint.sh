#!/bin/sh
set -eu

: "${POCKETBASE_HOST:=pocketbase:8090}"
: "${POCKETBASE_UPSTREAM:=http://${POCKETBASE_HOST}}"
export POCKETBASE_HOST
export POCKETBASE_UPSTREAM
envsubst '${POCKETBASE_UPSTREAM}' < /etc/nginx/templates/nginx.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
