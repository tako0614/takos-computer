FROM denoland/deno:2 AS builder
WORKDIR /workspace

# Copy workspace config and lockfile
COPY deno.json deno.lock* ./

# Copy required packages
COPY packages/common/ ./packages/common/
COPY packages/agent-core/ ./packages/agent-core/
COPY packages/actions-engine/ ./packages/actions-engine/
COPY packages/computer-core/ ./packages/computer-core/
COPY packages/computer-agent/ ./packages/computer-agent/
COPY packages/executor-service/ ./packages/executor-service/
COPY apps/executor/ ./apps/executor/

# Cache dependencies
RUN deno cache apps/executor/src/index.ts

FROM denoland/deno:alpine-2
WORKDIR /workspace

RUN apk add --no-cache ca-certificates

COPY --from=builder /workspace /workspace
COPY --from=builder /root/.cache/deno /root/.cache/deno

WORKDIR /workspace/apps/executor

# Run as non-root for security
RUN addgroup -S agent && adduser -S agent -G agent && \
    chown -R agent:agent /workspace
USER agent

ENV PORT=8080

EXPOSE 8080

CMD ["deno", "run", "--allow-all", "src/index.ts"]
