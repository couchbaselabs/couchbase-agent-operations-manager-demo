FROM nginx:alpine

# Corporate TLS-inspecting proxy support: this build has no network step
# today (it just copies static files), but the CA is provisioned here too —
# same mechanism as backend/Dockerfile — so an `apk add` or asset fetch
# added later keeps working behind a corporate proxy without revisiting
# this file. A no-op (empty file) on machines without such a proxy.
COPY certs/corporate-ca.crt /usr/local/share/ca-certificates/corporate-ca.crt
# See backend/Dockerfile for why this can't just be `apk add ca-certificates`
# followed by `update-ca-certificates` on a network with a TLS-inspecting
# proxy: apk's bootstrap trust store doesn't yet know the corporate root CA
# (that's what we're installing), so its HTTPS fetch of the package index
# fails with "TLS: server certificate not trusted" first. Fetch this one
# package over plain HTTP to sidestep that, then restore HTTPS.
RUN set -eu; \
    HAS_CA=0; \
    if [ -s /usr/local/share/ca-certificates/corporate-ca.crt ]; then HAS_CA=1; fi; \
    if [ "$HAS_CA" = "1" ]; then \
      cp /etc/apk/repositories /etc/apk/repositories.orig; \
      sed -i 's#https://#http://#g' /etc/apk/repositories; \
    fi; \
    apk add --no-cache ca-certificates; \
    if [ "$HAS_CA" = "1" ]; then \
      update-ca-certificates; \
      mv /etc/apk/repositories.orig /etc/apk/repositories; \
      echo "Corporate proxy root CA trusted for this build."; \
    fi

COPY public /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
