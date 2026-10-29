# syntax=docker/dockerfile:1

# ---- build: compile the client (Vite + Tailwind) and the service worker ----
FROM node:22-trixie-slim AS build
WORKDIR /app
# compilers are only needed if a native module (sqlite3, bcrypt) has no prebuilt binary for this platform
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime: production dependencies + built client + server only ----
FROM node:22-trixie-slim
ENV NODE_ENV=production \
    PORT=20100 \
    HOST=0.0.0.0 \
    DB_PATH=/data/obsidian.db
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json server.js vite.config.js ./
COPY --chown=node:node server ./server
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 20100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||20100)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
