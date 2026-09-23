# syntax=docker/dockerfile:1
# SILIKA — on-prem image. Build: docker build -t silika .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Builder doubles as the migration runner (has tsx + drizzle migrations).
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 silika && useradd --system --uid 1001 --gid silika silika
COPY --from=builder --chown=silika:silika /app/.next/standalone ./
COPY --from=builder --chown=silika:silika /app/.next/static ./.next/static
COPY --from=builder --chown=silika:silika /app/public ./public
USER silika
EXPOSE 3000
CMD ["node", "server.js"]
