# Multi-stage build for the Fastify server.
FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates rsync sqlite3 poppler-utils \
    libreoffice-core libreoffice-writer libreoffice-impress libreoffice-calc \
    fonts-noto-cjk fontconfig \
  && rm -rf /var/lib/apt/lists/*

# ---------- deps: 모노레포 manifest만 복사해서 의존성 설치 ----------
FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm install --workspaces --include-workspace-root --omit=optional=false

# ---------- build: 소스 복사 + Prisma generate + tsc ----------
FROM deps AS build
COPY . .
RUN npm -w apps/server run db:generate
RUN npm -w apps/server run build

# ---------- runtime: 가벼운 최종 이미지 ----------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Prisma generate가 build 단계에서 node_modules/.prisma 를 생성하므로
# build 단계의 node_modules를 가져와야 함.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/prisma ./apps/server/prisma
COPY --from=build /app/packages/shared ./packages/shared
COPY package.json package-lock.json* ./
COPY apps/server/package.json ./apps/server/
EXPOSE 3000
WORKDIR /app/apps/server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
