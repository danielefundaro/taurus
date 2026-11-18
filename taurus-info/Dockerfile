# syntax=docker/dockerfile:1.7
FROM node:26-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
# Node 26 non include più corepack: pnpm si installa con npm, alla versione di `packageManager`.
# Lo script di installazione di pnpm collega il suo eseguibile nativo, e npm lo esegue solo se ammesso.
RUN npm install --global --allow-scripts=pnpm "$(node -p "require('./package.json').packageManager")" \
    && pnpm install --frozen-lockfile

COPY . .

ARG SITE_URL=https://info-taurus.it
ARG PUBLIC_APP_URL=https://app-taurus.it
ARG PUBLIC_CONTACT_EMAIL=ing.daniele.fundaro@gmail.com
ENV SITE_URL=$SITE_URL \
    PUBLIC_APP_URL=$PUBLIC_APP_URL \
    PUBLIC_CONTACT_EMAIL=$PUBLIC_CONTACT_EMAIL \
    ASTRO_TELEMETRY_DISABLED=1

RUN pnpm build

# Come il frontend: la linea stabile di nginx senza privilegi, con l'utente nginx (uid 101) e la
# porta 8080.
FROM nginxinc/nginx-unprivileged:1.30-alpine

# Le correzioni di sicurezza di Alpine, come nel frontend.
USER root
ARG PACKAGES_REFRESH=
RUN apk upgrade --no-cache

COPY nginx.conf /etc/nginx/conf.d/default.conf
# Fuori da conf.d: i file .conf di quella cartella sono caricati come configurazioni a sé.
COPY security-headers.conf /etc/nginx/taurus-security-headers.conf
COPY --from=builder /app/dist /usr/share/nginx/html

USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
