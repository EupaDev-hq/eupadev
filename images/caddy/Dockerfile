# Caddy of the public sites (forge, auth and chat page, Previews, Prod) with
# the OVH DNS module: Let's Encrypt by the DNS-01 challenge (ADR-015, option
# 1), nothing exposed to the Internet. xcaddy builds Caddy v2.11.6 with the
# module pinned, on the Go image by digest; the binary
# is copied into the official runtime image by digest (same digest as the
# plain Caddy of the agents' AI proxy). Built, scanned and signed by the forge
# CI (repository `caddy`), like keycloak: never built on a VM.
# Go toolchain image rather than caddy:builder: its Go lags the stdlib fixes
# (Trivy HIGH on net/http, crypto/tls and crypto/x509 before Go 1.27.3).
FROM golang:1.27.3-alpine@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb AS builder
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7 \
 && CGO_ENABLED=0 xcaddy build v2.11.6 --output /usr/bin/caddy --with github.com/caddy-dns/ovh@v1.1.0 \
    --replace golang.org/x/net=golang.org/x/net@v0.60.0 \
    --replace github.com/go-jose/go-jose/v4=github.com/go-jose/go-jose/v4@v4.1.6

FROM caddy:2.11.6-alpine@sha256:d44355d3c2149dc580ce2cac735955d1c08d3d00882c30489c241aa51a5c10d9
# ponytail: the official image lags Alpine fixes (brotli, curl HIGH); upgrade at
# build time, drop when a newer caddy:alpine digest carries them.
RUN apk upgrade --no-cache
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
