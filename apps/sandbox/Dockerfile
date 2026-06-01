FROM oven/bun:1 AS builder
WORKDIR /workspace

# Copy workspace config and lockfile.
COPY package.json bun.lock tsconfig.json bunfig.toml ./
COPY shims/ ./shims/

# Copy required packages
COPY packages/common/ ./packages/common/
COPY packages/cloudflare-compat/ ./packages/cloudflare-compat/
COPY packages/computer-hosts/ ./packages/computer-hosts/
COPY packages/dashboard/ ./packages/dashboard/
COPY packages/sandbox-service/ ./packages/sandbox-service/
COPY apps/sandbox/ ./apps/sandbox/

RUN bun install --frozen-lockfile

# Production stage
FROM oven/bun:1

# Install common developer tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git curl jq build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY --from=builder /workspace /workspace

# Run as non-root for security
RUN groupadd -r sandbox && useradd -r -g sandbox -m sandbox && \
    chown -R sandbox:sandbox /workspace && \
    mkdir -p /home/sandbox/workspace && chown sandbox:sandbox /home/sandbox/workspace
USER sandbox

ENV PORT=8080

EXPOSE 8080

CMD ["bun", "apps/sandbox/src/index.ts"]
