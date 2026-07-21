#!/bin/sh
set -eu

: "${POCKETBASE_HOST:=pocketbase:8090}"
export POCKETBASE_HOST
envsubst '${POCKETBASE_HOST}' < /etc/nginx/templates/nginx.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
