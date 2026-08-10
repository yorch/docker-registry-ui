# Copyright (C) 2016-2018  Jones Magloire @Joxit
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.
FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY rollup.config.js ./
COPY rollup/ ./rollup/
# rollup/mock-registry-plugin.js imports dev/mock-registry/server.js at module
# load, so rollup cannot start without it -- production builds included.
COPY dev/ ./dev/
COPY src/ ./src/
# The commit this bundle is built from, surfaced in the app footer. `.dockerignore`
# does not allowlist `.git`, so rollup cannot read it here and the workflows pass
# it in instead. Declared after the COPYs above so a new SHA does not invalidate
# the `npm ci` layer. Leaving it unset is fine -- the footer omits the hash.
ARG COMMIT_HASH
RUN npm run build

FROM nginx:alpine-slim

LABEL maintainer="Jorge Barnaby (yorch)"
LABEL org.opencontainers.image.title="Registry Explorer"
LABEL org.opencontainers.image.description="A web UI for private docker registry"
LABEL org.opencontainers.image.source="https://github.com/yorch/docker-registry-ui"
LABEL org.opencontainers.image.licenses="AGPL-3.0"

WORKDIR /usr/share/nginx/html/

ENV NGINX_PROXY_HEADER_Host '$http_host'
ENV NGINX_LISTEN_PORT '80'

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY bin/90-docker-registry-ui.sh /docker-entrypoint.d/90-docker-registry-ui.sh
COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY favicon.ico /usr/share/nginx/html/

RUN chown -R nginx:nginx /etc/nginx/ /usr/share/nginx/html/ /var/cache/nginx /var/log/nginx