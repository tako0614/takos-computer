#!/bin/bash
set -e

XVFB_RESOLUTION="${XVFB_RESOLUTION:-1280x720x24}"

echo "[entrypoint] Starting Xvfb :99 at ${XVFB_RESOLUTION}" >&2
Xvfb :99 -screen 0 "${XVFB_RESOLUTION}" -ac +extension GLX +render -noreset &
XVFB_PID=$!
export DISPLAY=:99

# Wait for Xvfb to be ready
for i in $(seq 1 20); do
  if xdpyinfo -display :99 >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$XVFB_PID" 2>/dev/null; then
    echo "[entrypoint] ERROR: Xvfb failed to start" >&2
    exit 1
  fi
  sleep 0.2
done

echo "[entrypoint] Starting openbox (window manager)" >&2
openbox &
WM_PID=$!

echo "[entrypoint] Starting x11vnc on port 5900" >&2
x11vnc -display :99 -nopw -listen localhost -forever -shared -rfbport 5900 -quiet &
X11VNC_PID=$!

# Verify background services are alive
sleep 0.5
for name_pid in "Xvfb:$XVFB_PID" "openbox:$WM_PID" "x11vnc:$X11VNC_PID"; do
  IFS=: read -r svc pid <<< "$name_pid"
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "[entrypoint] ERROR: $svc (PID $pid) failed to start" >&2
    exit 1
  fi
done

# Cleanup on exit — kill all children
cleanup() {
  echo "[entrypoint] Shutting down..." >&2
  kill $X11VNC_PID 2>/dev/null || true
  kill $WM_PID 2>/dev/null || true
  kill $XVFB_PID 2>/dev/null || true
}
trap cleanup EXIT

echo "[entrypoint] Display stack ready. Starting Node.js application." >&2
exec node dist/index.js
