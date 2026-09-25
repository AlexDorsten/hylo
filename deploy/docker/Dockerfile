# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates git python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare yarn@4.9.2 --activate
WORKDIR /app
COPY . .
ENV HUSKY=0 YARN_ENABLE_IMMUTABLE_INSTALLS=true
RUN yarn workspaces focus backend web
RUN yarn build-packages
RUN node --test test/self-hosting/*.test.cjs

# Everything prefixed VITE_ is public and embedded into the browser bundle.
ARG PUBLIC_ORIGIN=https://hylo.example.org
ARG VITE_FILESTACK_API_KEY=
ARG VITE_MAPBOX_TOKEN=
ARG VITE_STRIPE_CLIENT_ID=
ENV VITE_API_HOST=${PUBLIC_ORIGIN} VITE_SOCKET_HOST=${PUBLIC_ORIGIN}
# Vite's large bundle needs more than Node's default heap under amd64 emulation.
# Keep this allowance scoped to the build; runtime limits are set by the operator.
RUN NODE_OPTIONS=--max-old-space-size=4096 yarn workspace web build

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare yarn@4.9.2 --activate \
    && chmod -R a+rX /opt/corepack
ENV NODE_ENV=production COREPACK_ENABLE_NETWORK=0
WORKDIR /app
# Backend runtime uses Babel and other packages currently in devDependencies.
# Do not prune them until the upstream dependency layout supports it.
COPY --from=build --chown=node:node /app /app
USER node
WORKDIR /app/apps/backend
# Verify the unprivileged runtime can use the bundled Yarn without a download.
RUN --network=none test "$(yarn --version)" = 4.9.2
EXPOSE 3001 9001
CMD ["node", "--optimize_for_size", "--gc_interval=100", "app.js"]
