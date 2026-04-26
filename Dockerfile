# ── Stage 1: Build frontend ──
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_API_URL=https://shalomapp.in
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ── Stage 2: Build backend ──
FROM node:20-alpine AS backend-build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc --outDir dist

# ── Stage 3: Production dependencies ──
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# ── Stage 4: Production image ──
FROM node:20-alpine
WORKDIR /app

# Copy only installed production deps so dev lockfile metadata is not present
# in the final image layers scanned by Trivy.
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy compiled backend
COPY --from=backend-build /app/dist ./dist

# Copy frontend build (served by Express or placed behind CloudFront)
COPY --from=frontend-build /app/frontend/dist ./public

# Copy migration SQL
COPY db/aws_rds_full_schema.sql ./db/
COPY db/migrations/ ./db/migrations/
COPY docker-entrypoint.sh ./

# Install wget (health check + CA bundle download).
# The || true means a build-time network failure won't break the image —
# dbClient.ts detects the missing file at startup and warns instead of crashing.
RUN apk add --no-cache wget && \
    wget -q --timeout=30 \
      -O /etc/ssl/certs/rds-ca-bundle.pem \
      https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    || echo "WARNING: RDS CA bundle download failed — SSL cert verification will be skipped"

# CRIT-06: Run as non-root user
RUN chmod +x docker-entrypoint.sh && \
    addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -D appuser
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://localhost:4000/health || exit 1

EXPOSE 4000

CMD ["sh", "docker-entrypoint.sh"]
