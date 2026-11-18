# syntax=docker/dockerfile:1.7
# =========================
# BUILD STAGE
# =========================
FROM node:26-alpine AS builder

WORKDIR /app

# Copia package files
COPY package*.json ./

# Install dipendenze
RUN npm ci

# Copia sorgenti
COPY . .

# Build Angular production
RUN npm run build -- --configuration production

# =========================
# RUNTIME STAGE
# =========================
# La linea stabile di nginx, nella variante senza privilegi: gira con l'utente nginx (uid 101) e
# ascolta sulla porta 8080, perché un utente senza privilegi non può aprire le porte sotto la 1024.
FROM nginxinc/nginx-unprivileged:1.30-alpine

USER root

# Le correzioni di sicurezza di Alpine: l'immagine di nginx si ripubblica solo di tanto in tanto, e
# fra una pubblicazione e l'altra i suoi pacchetti restano indietro. nginx e i suoi moduli restano
# quelli di nginx.org, perché l'immagine li fissa alla loro versione. PACKAGES_REFRESH cambia a ogni
# pubblicazione, perché la cache di build non riusi un aggiornamento vecchio: vedi
# .github/workflows/docker-publish.yml.
ARG PACKAGES_REFRESH=
RUN apk upgrade --no-cache

# Pulizia contenuto default: la cartella è di root, come i file dell'applicazione copiati sotto.
RUN rm -rf /usr/share/nginx/html/*

# Il modello della configurazione: l'entrypoint dell'immagine sostituisce le variabili TAURUS_* e
# scrive /etc/nginx/conf.d/default.conf, che nell'immagine appartiene all'utente nginx.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
# Fuori da conf.d: i file .conf di quella cartella sono caricati come configurazioni a sé.
COPY security-headers.conf /etc/nginx/taurus-security-headers.conf
# Scrive assets/config.json dalle variabili d'ambiente, prima che nginx parta.
COPY --chmod=0755 docker-entrypoint.d/40-taurus-runtime-config.sh /docker-entrypoint.d/40-taurus-runtime-config.sh
# Le note sulle licenze delle librerie nel bundle (PrimeUI License), fuori dalla cartella servita.
COPY THIRD_PARTY_NOTICES.md /usr/share/doc/taurus-fe/THIRD_PARTY_NOTICES.md

# Copia build Angular. I file restano di root e nginx li legge soltanto; l'unico che il container
# riscrive è la configurazione a runtime, che appartiene quindi all'utente nginx.
COPY --from=builder /app/dist/sakai-ng/browser /usr/share/nginx/html
COPY --from=builder --chown=101:101 /app/dist/sakai-ng/browser/assets/config.json /usr/share/nginx/html/assets/config.json

USER 101

# Indirizzi interni dei servizi a cui questo container inoltra /api e /auth, e valori che finiscono
# nella configurazione servita al browser. Sono i valori predefiniti del compose: una distribuzione
# li sovrascrive con le proprie variabili d'ambiente.
ENV NGINX_ENVSUBST_FILTER=^TAURUS_ \
    TAURUS_API_UPSTREAM=http://backend:8080 \
    TAURUS_KEYCLOAK_UPSTREAM=http://keycloak:9080 \
    TAURUS_DNS_RESOLVER=127.0.0.11 \
    TAURUS_MAX_UPLOAD_SIZE=500m \
    TAURUS_API_BASE_URL=/api \
    TAURUS_KEYCLOAK_BASE_URL=/auth \
    TAURUS_KEYCLOAK_REALM=taurus \
    TAURUS_KEYCLOAK_CLIENT_ID=web_app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
