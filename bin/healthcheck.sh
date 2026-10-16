#!/bin/sh
# Container HEALTHCHECK: the UI itself answers 200 on `/`.
#
# `/` is served from disk by nginx, so this deliberately says nothing about the
# registry behind /v2: a registry that is down must not mark the UI unhealthy.
#
# The address mirrors what the entrypoint hook (90-docker-registry-ui.sh)
# configures: NGINX_LISTEN_PORT is a port or an address:port (the image sets it
# to 80). The hook moves a non-root user from exactly "80" to 8080; an empty value
# leaves nginx on 80. Uses curl when the image
# has it (debian) and busybox wget otherwise (alpine); neither is installed for this.

listen="${NGINX_LISTEN_PORT-80}"
if [ "$listen" = 80 ] && [ "$(id -u)" != 0 ]; then
  listen=8080
elif [ -z "$listen" ]; then
  listen=80
fi
case $listen in
  *:*) url="http://$listen/" ;;
  *) url="http://127.0.0.1:$listen/" ;;
esac

if command -v curl > /dev/null 2>&1; then
  exec curl -fsS -o /dev/null --max-time 4 "$url"
fi
exec wget -q -O /dev/null -T 4 "$url"
