#!/bin/sh
set -e
CONF=/etc/nginx/conf.d/default.conf
RESOLVER=$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf)
SEARCH=$(awk '/^search/ { print $2; exit }' /etc/resolv.conf)
if [ -n "$SEARCH" ]; then
  BACKEND_HOST="backend.${SEARCH}"
else
  BACKEND_HOST="backend"
fi
if [ -f "$CONF" ]; then
  [ -n "$RESOLVER" ] && sed -i "s/__RESOLVER__/${RESOLVER}/g" "$CONF"
  sed -i "s/__BACKEND_HOST__/${BACKEND_HOST}/g" "$CONF"
fi
