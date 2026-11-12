# The API, built once and run as-is.
#
# Two stages, and the second keeps the full dependency tree rather than the
# usual production-only slice. That is deliberate: `prisma migrate deploy` runs
# on every boot, it loads `prisma.config.ts`, and a runtime image that had been
# stripped down would discover that at three in the morning on somebody's VPS
# rather than here. A few tens of megabytes is a cheap price for the migration
# step working with exactly the toolchain that was tested.

# The build context is the repository root, not `server/` — the compose file
# builds both images from one context — so every path below is prefixed.
#
# --- build -------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them.
COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/prisma ./prisma
COPY server/prisma.config.ts ./
# The generated client is gitignored and must be produced here; nothing in the
# repository contains it.
RUN npx prisma generate

COPY server/tsconfig.json ./
# Merged onto the generated client already at /app/src/generated, which the
# repository does not contain and .dockerignore keeps out.
COPY server/src ./src
RUN npm run build
# Load the compiled Prisma client once, so an image that would crash on start
# fails here, in CI, instead. (It once did: the generated imports pointed at .ts
# files that do not exist in dist.)
RUN node -e "require('./dist/generated/prisma/client.js')"

# --- runtime -----------------------------------------------------------------
FROM node:22-alpine AS runtime

# tini reaps zombies and passes signals through, so the graceful shutdown the
# server implements — closing the scheduler and the database pool — actually
# runs when the container is stopped.
#
# Chromium prints the signed agreement to PDF (ContractPdfService): it is the
# only thing available here that shapes Urdu correctly. The Urdu font itself is
# embedded from node_modules, so only a Latin face is installed alongside. This
# adds roughly 500 MB to the image and a few hundred MB of memory for the
# second or two a PDF takes; remove both packages and the endpoint answers 503
# while browser printing keeps working.
RUN apk add --no-cache tini chromium ttf-liberation

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/generated ./src/generated
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
COPY server/package.json ./

# Not root. A web process that is compromised should not own the filesystem it
# is standing on.
USER node

EXPOSE 5000

ENTRYPOINT ["/sbin/tini", "--"]

# Migrations run before the server accepts a request. `migrate deploy` applies
# only what is pending and never generates anything, which is what makes it safe
# to run on every start — including three containers starting at once, because
# Prisma takes an advisory lock.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
