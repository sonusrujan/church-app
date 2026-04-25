# ── Stage 1: Build frontend ──
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Build backend ──
FROM node:20-alpine AS backend-build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc --outDir dist

# ── Stage 3: Production image ──
FROM node:20-alpine
WORKDIR /app

# Install postgresql-client for running migrations
RUN apk add --no-cache postgresql-client

# Install only production deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled backend
COPY --from=backend-build /app/dist ./dist

# Copy frontend build (served by Express or placed behind CloudFront)
COPY --from=frontend-build /app/frontend/dist ./public

# Copy migration SQL
COPY db/aws_rds_full_schema.sql ./db/
COPY db/migrations/ ./db/migrations/
COPY docker-entrypoint.sh ./

# CRIT-06: Run as non-root user
RUN chmod +x docker-entrypoint.sh && \
    addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -D appuser
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://localhost:4000/health || exit 1

EXPOSE 4000

CMD ["sh", "docker-entrypoint.sh"]
