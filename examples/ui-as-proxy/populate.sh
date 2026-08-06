#!/bin/bash

docker tag ghcr.io/yorch/docker-registry-ui:static localhost/yorch/docker-registry-ui:static
docker tag ghcr.io/yorch/docker-registry-ui:static localhost/yorch/docker-registry-ui:0.3
docker tag ghcr.io/yorch/docker-registry-ui:static localhost/yorch/docker-registry-ui:0.3.0
docker tag ghcr.io/yorch/docker-registry-ui:static localhost/yorch/docker-registry-ui:0.3.0-static
docker tag ghcr.io/yorch/docker-registry-ui:static localhost/yorch/docker-registry-ui:0.3-static

docker push localhost/yorch/docker-registry-ui

docker tag registry:2.6.2 localhost/registry:latest
docker tag registry:2.6.2 localhost/registry:2.6.2
docker tag registry:2.6.2 localhost/registry:2.6
docker tag registry:2.6.2 localhost/registry:2.6.0
docker tag registry:2.6.2 localhost/registry:2

docker push localhost/registry