# PetBattle API 镜像（本地 Demo / 2C2G 单机）。
#
# 构建上下文是仓库根目录：docker compose -f server/docker-compose.yml build
# 运行的是 TS 源码（tsx）；真正的产物形态（esbuild bundle）是 CONTRACT §10.5 的未决项，
# M1 先保证「一条命令起服务 + Postgres」可用。
FROM node:22-alpine

RUN apk add --no-cache curl tini
RUN corepack enable

WORKDIR /app

# 只拷 manifest，先让依赖层可缓存。
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/protocol/package.json packages/protocol/
COPY packages/sim/package.json packages/sim/
COPY server/package.json server/
COPY tools/package.json tools/
COPY tests/e2e/package.json tests/e2e/
RUN pnpm install --frozen-lockfile

# 临时桥：`pg` 还没进 server/package.json（锁文件只由 0 号改）。
# 装到独立目录并用 NODE_PATH 兜底；0 号加上依赖后删掉这一段即可。
RUN mkdir -p /opt/petbattle-pg \
  && cd /opt/petbattle-pg \
  && npm init -y >/dev/null \
  && npm install --omit=dev --no-audit --no-fund pg@8.13.1
ENV NODE_PATH=/opt/petbattle-pg/node_modules

COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY server server

# 2C2G：Node 堆上限 1G（TECH_DESIGN §16.1）。
ENV NODE_OPTIONS=--max-old-space-size=1024
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --retries=6 \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "exec", "tsx", "server/src/main.ts"]
