FROM denoland/deno:2 AS builder
WORKDIR /workspace

# Copy workspace config and lockfile
COPY deno.json deno.lock* ./

# Copy required packages
COPY packages/common/ ./packages/common/
COPY packages/browser-service/ ./packages/browser-service/
COPY apps/browser/ ./apps/browser/

# Cache dependencies
RUN deno cache apps/browser/src/index.ts

# Production stage -- Playwright base image with Chromium pre-installed
FROM mcr.microsoft.com/playwright:v1.58.2-noble

# Install VNC stack, window manager, display interaction, common tools, and Deno
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates xvfb x11vnc openbox xterm \
    xdotool scrot xclip x11-xserver-utils \
    curl jq fonts-liberation unzip && \
    curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY --from=builder /workspace /workspace
COPY --from=builder /root/.cache/deno /root/.cache/deno

WORKDIR /workspace/apps/browser

# Copy entrypoint script
COPY apps/browser/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Run as non-root for security
RUN groupadd -r browser && useradd -r -g browser -m browser && \
    chown -R browser:browser /workspace && \
    mkdir -p /tmp/browser-profile && chown -R browser:browser /tmp/browser-profile
USER browser

ENV PORT=8080
ENV DISPLAY=:99

EXPOSE 8080

CMD ["./entrypoint.sh"]
