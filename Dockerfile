# syntax=docker/dockerfile:1.7

FROM node:24.16.0-bookworm-slim AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.21.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=secret,id=github_packages_token,required=true \
    token="$(cat /run/secrets/github_packages_token)" && \
    printf '%s\n' \
      '@jagr-dirego:registry=https://npm.pkg.github.com' \
      "//npm.pkg.github.com/:_authToken=${token}" \
      'always-auth=true' > /tmp/npmrc && \
    NPM_CONFIG_USERCONFIG=/tmp/npmrc pnpm install --frozen-lockfile && \
    rm -f /tmp/npmrc

FROM dependencies AS build

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN pnpm build && pnpm prune --prod

FROM node:24.16.0-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health/live').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "dist/src/main.js"]
