# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
# The lockfile is pnpm 10.x; pin the same major the repo declares in packageManager.
RUN npm install -g pnpm@10.12.1

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# src/db/index.ts throws at module load when DATABASE_URL is unset, and
# `next build` evaluates route modules while collecting page data. neon() only
# parses the string, so this placeholder never opens a connection. The real
# value arrives at runtime from compose env_file.
ARG DATABASE_URL="postgres://build:build@build.example.neon.tech/build"
ENV DATABASE_URL=$DATABASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# This project has no public/ directory, so only the standalone server and the
# compiled static assets are copied.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
