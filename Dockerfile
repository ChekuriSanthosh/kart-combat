# Kart Combat — production image.
#
# There is no build step to run here. The server is plain Node, and the browser
# imports the very same `shared/` modules the server executes, served straight
# off disk. So this only installs dependencies and copies source.

FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Dependencies go in their own layer so editing source does not reinstall them.
#
# --omit=dev is not just tidiness: Playwright is a devDependency and its
# postinstall downloads an entire browser. Leaving it in would add hundreds of
# megabytes to an image that never runs a test.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev

# three is a *runtime* dependency here, not a build-time one — server.js serves
# node_modules/three/build at /vendor/three so the game works with no CDN and
# no network beyond the game itself.
COPY --chown=node:node . .

# Drop root for anything that runs from here on.
USER node

# Read by server.js via process.env.PORT, and must match `internal_port` in
# fly.toml. listen() already binds 0.0.0.0, which containers require — a server
# bound to localhost would be unreachable from outside the container.
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
