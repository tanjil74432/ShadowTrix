# syntax=docker/dockerfile:1
# Portable production image for the single Next.js application (frontend and backend run in this one process).
#   docker build --build-arg APP_URL=https://your.public.address -t shadowtrix-web .
# APP_URL is baked into prerendered pages, so the value at BUILD time must equal the value at RUN time (docs/operations/deployment.md).
# Nothing secret is baked in: the placeholders below exist only so the build can run and are replaced at run time.
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci
COPY . .
ARG APP_URL
ENV APP_URL=${APP_URL} \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    AUTH_SECRET="build-only-placeholder-not-used-at-run-time-0123456789"
RUN npx prisma generate && npm run build

FROM base AS run
ENV NODE_ENV=production
# The full dependency set is kept on purpose: the prisma CLI (migrations) and tsx (admin and maintenance commands) are needed in the image.
COPY --from=build /app ./
USER node
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3010/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start"]
