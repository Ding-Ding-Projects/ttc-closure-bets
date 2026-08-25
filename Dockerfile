ARG NODE_IMAGE=node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ARG VERSION=dev
ARG REVISION=unknown
ARG SOURCE_URL=https://github.com/Ding-Ding-Projects/ttc-closure-bets
ARG CREATED=unknown
LABEL org.opencontainers.image.title="TTC Closure Bets" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.revision="$REVISION" \
      org.opencontainers.image.source="$SOURCE_URL" \
      org.opencontainers.image.created="$CREATED"
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/ttc-closure-bets.sqlite
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY public ./public
RUN mkdir -p /data /tmp/app && chown -R node:node /data /tmp/app /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
