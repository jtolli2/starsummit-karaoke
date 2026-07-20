#!/bin/sh
set -eu

/usr/local/bin/pocketbase migrate up --dir=/pb/pb_data
exec /usr/local/bin/pocketbase serve --dir=/pb/pb_data --http=0.0.0.0:8090
