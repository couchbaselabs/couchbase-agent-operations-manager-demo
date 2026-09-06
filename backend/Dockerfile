FROM node:20-alpine

WORKDIR /app

# Corporate TLS-inspecting proxy support (Zscaler, Netskope, GlobalProtect,
# etc.): if scripts/setup-corporate-ca.sh was run on the host first, this
# picks up the exported proxy root CA so `npm install` below can verify TLS
# through the proxy instead of failing with SELF_SIGNED_CERT_IN_CHAIN. A
# no-op (empty file) on machines without such a proxy.
COPY certs/corporate-ca.crt /usr/local/share/ca-certificates/corporate-ca.crt
# `apk add ca-certificates` itself needs the Alpine package index over
# HTTPS, but apk's own bootstrap trust store has no idea about a corporate
# TLS-inspecting proxy's root CA -- that's the very thing we're installing
# below -- so on a proxied network this fetch fails with "TLS: server
# certificate not trusted" before update-ca-certificates ever gets to run.
# Break that chicken-and-egg loop by fetching just this one package over
# plain HTTP (nothing to intercept-and-reject on an unencrypted connection),
# then flip back to HTTPS once the corporate CA is actually trusted.
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
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV PORT=4000
EXPOSE 4000

CMD ["node", "src/server.js"]
