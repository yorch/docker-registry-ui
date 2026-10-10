#!/bin/sh
# Renders the container's configuration from environment variables into
# index.html and the nginx config. Runs as an nginx entrypoint hook on every
# container start.
#
# Two things matter about how:
#
# - It always renders from a pristine copy taken on the first start (under
#   $UI_NGINX_DIR/.registry-ui/), never from the previously rendered file, so
#   `docker restart` with a changed environment takes effect.
# - Environment values are data. Each one is escaped for the sed replacement it
#   passes through, and for the HTML attribute or nginx string it ends up in; a
#   value that cannot be made safe for nginx stops the container with a message
#   instead of producing a config that means something else.
#
# UI_INDEX_HTML and UI_NGINX_DIR default to the locations in the image. They
# exist so test/entrypoint.test.js can run this script outside a container.

INDEX_HTML="${UI_INDEX_HTML:-index.html}"
NGINX_DIR="${UI_NGINX_DIR:-/etc/nginx}"
DEFAULT_CONF="${NGINX_DIR}/conf.d/default.conf"
PRISTINE_DIR="${NGINX_DIR}/.registry-ui"

# Default policy. The bundle is a single script and stylesheet and every font and
# image is served from the same origin, so everything but connect-src is 'self'.
# connect-src is open to http: and https: because the registry is a user-chosen
# origin (the UI can add registries at runtime) and the version check calls GitHub.
# style-src allows inline styles for the one inline `style` attribute in the UI.
DEFAULT_CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' http: https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

NL='
'

die() {
  echo "90-docker-registry-ui: $*" >&2
  exit 1
}

# Escape a value for use as the replacement of `s|...|HERE|`.
sed_escape() {
  printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'
}

html_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&#39;/g"
}

# A value that is written inside a double-quoted nginx string. A quote, a
# backslash or a newline ends or changes the string, and `;` ends the directive.
# $1 = variable name (for the message), $2 = value, $3 = "semicolon" to reject `;`.
check_nginx_value() {
  case $2 in
    *'"'*) die "$1 must not contain a double quote" ;;
    *'\'*) die "$1 must not contain a backslash" ;;
    *"$NL"*) die "$1 must not contain a newline" ;;
  esac
  if [ "$3" = semicolon ]; then
    case $2 in
      *';'*) die "$1 must not contain a semicolon" ;;
    esac
  fi
}

# Taken once, on the first start of a container. A bind-mounted replacement for
# either file is therefore only picked up by a new container, not a restart.
mkdir -p "$PRISTINE_DIR" || die "cannot create $PRISTINE_DIR"
[ -f "$PRISTINE_DIR/index.html" ] || cp "$INDEX_HTML" "$PRISTINE_DIR/index.html" || die "cannot save a pristine index.html"
[ -f "$PRISTINE_DIR/default.conf" ] || cp "$DEFAULT_CONF" "$PRISTINE_DIR/default.conf" || die "cannot save a pristine default.conf"

SED_HTML=$(mktemp) || die "mktemp failed"
SED_CONF=$(mktemp) || die "mktemp failed" # structural edits (comment markers, deletions)
SED_VALS=$(mktemp) || die "mktemp failed" # ${NAME} -> value, applied after SED_CONF so a value is never re-edited
SED_TMP=$(mktemp) || die "mktemp failed"
trap 'rm -f "$SED_HTML" "$SED_CONF" "$SED_VALS" "$SED_TMP"' EXIT

# html_subst NAME VALUE: ${NAME} -> VALUE as an HTML attribute value.
html_subst() {
  # A newline cannot be carried through a sed replacement; attributes are
  # single-line anyway.
  value=$(printf '%s' "$2" | tr '\n' ' ')
  printf 's|\\${%s}|%s|g\n' "$1" "$(sed_escape "$(html_escape "$value")")" >> "$SED_HTML"
}

# conf_subst NAME VALUE: ${NAME} -> VALUE, verbatim, in the nginx config.
conf_subst() {
  printf 's|\\${%s}|%s|g\n' "$1" "$(sed_escape "$2")" >> "$SED_VALS"
}

for name in APP_NAME REGISTRY_URL REGISTRY_TITLE PULL_URL SINGLE_REGISTRY CATALOG_ELEMENTS_LIMIT \
  SHOW_CONTENT_DIGEST SHOW_TAG_HISTORY DEFAULT_REGISTRIES READ_ONLY_REGISTRIES SHOW_CATALOG_NB_TAGS \
  HISTORY_CUSTOM_LABELS USE_CONTROL_CACHE_HEADER TAGLIST_ORDER CATALOG_DEFAULT_EXPANDED \
  CATALOG_MIN_BRANCHES CATALOG_MAX_BRANCHES TAGLIST_PAGE_SIZE REGISTRY_SECURED \
  ENABLE_VERSION_NOTIFICATION; do
  html_subst "$name" "$(printenv "$name")"
done

for name in $(grep -o 'THEME[A-Z_]*' "$PRISTINE_DIR/index.html" | sort -u); do
  html_subst "$name" "$(printenv "$name")"
done

if [ -z "${DELETE_IMAGES}" ] || [ "${DELETE_IMAGES}" = false ]; then
  DELETE_ENABLED=false
  html_subst DELETE_IMAGES false
else
  DELETE_ENABLED=true
  html_subst DELETE_IMAGES true
fi

sed -f "$SED_HTML" "$PRISTINE_DIR/index.html" > "$INDEX_HTML" || die "cannot write $INDEX_HTML"

# Security headers. Unset or empty keeps the default policy; "off" removes the
# CSP and X-Frame-Options; anything else replaces the policy. A custom policy owns
# framing too (frame-ancestors), so the legacy X-Frame-Options, which would still
# be enforced alongside it, is dropped.
CSP="${CONTENT_SECURITY_POLICY}"
if [ "$CSP" = off ]; then
  echo "/Content-Security-Policy/d" >> "$SED_CONF"
  echo "/X-Frame-Options/d" >> "$SED_CONF"
else
  if [ -n "$CSP" ]; then
    check_nginx_value CONTENT_SECURITY_POLICY "$CSP"
    case $CSP in
      *'$'*) die "CONTENT_SECURITY_POLICY must not contain a dollar sign (nginx would expand it)" ;;
    esac
    echo "/X-Frame-Options/d" >> "$SED_CONF"
  else
    CSP="$DEFAULT_CSP"
  fi
  conf_subst CONTENT_SECURITY_POLICY "$CSP"
fi

# Builds `proxy_set_header`/`proxy_pass_header` directives from NGINX_PROXY_*
# variables, taken from the process environment and from /etc/nginx/.env.
# $1 = variable prefix, $2 = directive, $3 = "value" to also emit the value.
PROXY_DIRECTIVES=""
collect_proxy_directives() {
  prefix=$1
  directive=$2
  with_value=$3
  PROXY_DIRECTIVES=""
  # Process environment: the value is read with printenv by name, so a multi-line
  # value is seen whole instead of as an unrelated continuation line.
  for var in $(env | sed -n "s/^\(${prefix}[A-Za-z0-9_]*\)=.*/\1/p"); do
    add_proxy_directive "$var" "$(printenv "$var")"
  done
  if [ -f "${NGINX_DIR}/.env" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      case $line in
        "${prefix}"*=*) add_proxy_directive "${line%%=*}" "${line#*=}" ;;
      esac
    done < "${NGINX_DIR}/.env"
  fi
}

add_proxy_directive() {
  var=$1
  value=$2
  case $var in
    *[!A-Za-z0-9_]*) die "invalid variable name $var" ;;
  esac
  key=$(printf '%s' "${var#"$prefix"}" | tr '_' '-')
  if [ "$with_value" = value ]; then
    check_nginx_value "$var" "$value" semicolon
    PROXY_DIRECTIVES="${PROXY_DIRECTIVES}${directive} ${key} \"${value}\"; "
  else
    PROXY_DIRECTIVES="${PROXY_DIRECTIVES}${directive} \"${key}\"; "
  fi
}

if [ -n "${NGINX_PROXY_PASS_URL}" ]; then
  check_nginx_value NGINX_PROXY_PASS_URL "${NGINX_PROXY_PASS_URL}" semicolon
  conf_subst NGINX_PROXY_PASS_URL "${NGINX_PROXY_PASS_URL}"
  collect_proxy_directives NGINX_PROXY_HEADER_ proxy_set_header value
  conf_subst NGINX_PROXY_HEADERS "$PROXY_DIRECTIVES"
  collect_proxy_directives NGINX_PROXY_PASS_HEADER_ proxy_pass_header key
  conf_subst NGINX_PROXY_PASS_HEADERS "$PROXY_DIRECTIVES"
  echo "s,#! , ," >> "$SED_CONF" # The space is important here, to not interfer with #!r
  if [ "$DELETE_ENABLED" = false ]; then
    echo "s,#!d,   ," >> "$SED_CONF"
  fi
  if [ -n "${NGINX_RESOLVER}" ]; then
    check_nginx_value NGINX_RESOLVER "${NGINX_RESOLVER}" semicolon
    conf_subst NGINX_RESOLVER "${NGINX_RESOLVER}"
    echo "s,#r,," >> "$SED_CONF"
  else
    echo "s,#!r, ," >> "$SED_CONF" # The space is for cosmetic here
  fi
fi

if [ "$(whoami)" != "root" ]; then
  if [ "$NGINX_LISTEN_PORT" = "80" ]; then
    NGINX_LISTEN_PORT="8080"
  fi
  sed -e "/user  nginx;/d" -e "s,/run/nginx.pid,/tmp/nginx.pid," "${NGINX_DIR}/nginx.conf" > "$SED_TMP" &&
    cat "$SED_TMP" > "${NGINX_DIR}/nginx.conf"
fi

if [ -n "$NGINX_LISTEN_PORT" ] && [ "$NGINX_LISTEN_PORT" != "80" ]; then
  check_nginx_value NGINX_LISTEN_PORT "$NGINX_LISTEN_PORT" semicolon
  conf_subst_listen=$(sed_escape "$NGINX_LISTEN_PORT")
  echo "s,listen       80;,listen       ${conf_subst_listen};," >> "$SED_CONF"
fi

cat "$SED_CONF" "$SED_VALS" > "$SED_TMP"
sed -f "$SED_TMP" "$PRISTINE_DIR/default.conf" > "$DEFAULT_CONF" || die "cannot write $DEFAULT_CONF"
