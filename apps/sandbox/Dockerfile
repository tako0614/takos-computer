FROM denoland/deno:ubuntu AS builder
ENV DENO_DIR=/deno-dir
WORKDIR /workspace

# Copy workspace config and lockfile
COPY deno.json deno.lock* ./

# Copy required packages
COPY packages/common/ ./packages/common/
COPY packages/cloudflare-compat/ ./packages/cloudflare-compat/
COPY packages/computer-hosts/ ./packages/computer-hosts/
COPY packages/dashboard/ ./packages/dashboard/
COPY packages/sandbox-service/ ./packages/sandbox-service/
COPY apps/sandbox/ ./apps/sandbox/

# Cache dependencies
RUN deno cache apps/sandbox/src/index.ts

# Production stage
FROM denoland/deno:ubuntu
ENV DENO_DIR=/deno-dir

# Install common developer tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git curl jq build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY --from=builder /workspace /workspace
COPY --from=builder /deno-dir /deno-dir

WORKDIR /workspace/apps/sandbox

# Run as non-root for security
RUN groupadd -r sandbox && useradd -r -g sandbox -m sandbox && \
    chown -R sandbox:sandbox /workspace && \
    chown -R sandbox:sandbox /deno-dir && \
    mkdir -p /home/sandbox/workspace && chown sandbox:sandbox /home/sandbox/workspace
USER sandbox

ENV PORT=8080

EXPOSE 8080

CMD ["deno", \
    "run", \
    "--allow-read=.,../../packages,/home/sandbox/workspace", \
    "--allow-write=/home/sandbox/workspace", \
    "--allow-env", \
    "--allow-net=0.0.0.0:8080", \
    "--allow-run=bash,/bin/bash", \
    "src/index.ts"]
