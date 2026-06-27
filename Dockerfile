FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=builder /app/dist ./dist
# SQL migration files — applied at boot by the migrate runner (see `npm start`).
COPY sql ./sql
EXPOSE 3000
# `npm start` runs pending DB migrations, then launches the server. The runner is
# idempotent + advisory-locked, so it is safe on every deploy/restart.
CMD ["npm", "start"]
