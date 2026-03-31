/**
 * WebSocket-to-VNC TCP proxy.
 *
 * Bridges a WebSocket connection on `/internal/vnc` to the x11vnc
 * server on localhost:5900.  noVNC in the browser speaks RFB over
 * WebSocket — this module does the WebSocket ↔ raw-TCP translation
 * (the same job as websockify, but in-process).
 */

import { Buffer } from 'node:buffer';
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws';
import net from 'node:net';
import type http from 'node:http';

const VNC_HOST = '127.0.0.1';
const VNC_PORT = 5900;

interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export function createVncProxy(server: http.Server, logger: Logger): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (pathname !== '/vnc') {
      // Not our upgrade — ignore (let other handlers deal with it)
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws: WsWebSocket) => {
      bridgeToVnc(ws, logger);
    });
  });

  logger.info('[vnc-proxy] WebSocket-to-VNC proxy attached on /vnc');
}

function bridgeToVnc(ws: WsWebSocket, logger: Logger): void {
  const vnc = net.connect(VNC_PORT, VNC_HOST);

  vnc.on('connect', () => {
    logger.info('[vnc-proxy] Connected to x11vnc');
  });

  // VNC → WebSocket (binary frames)
  vnc.on('data', (data: Buffer) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  });

  // WebSocket → VNC
  ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    if (vnc.writable) {
      if (Buffer.isBuffer(data)) {
        vnc.write(data);
      } else if (data instanceof ArrayBuffer) {
        vnc.write(Buffer.from(data));
      } else {
        // Buffer[]
        for (const chunk of data) vnc.write(chunk);
      }
    }
  });

  // Cleanup on either side closing
  vnc.on('close', () => {
    logger.info('[vnc-proxy] VNC connection closed');
    ws.close();
  });

  vnc.on('error', (err) => {
    logger.warn('[vnc-proxy] VNC socket error', { error: String(err) });
    ws.close();
  });

  ws.on('close', () => {
    vnc.end();
  });

  ws.on('error', (err: Error) => {
    logger.warn('[vnc-proxy] WebSocket error', { error: String(err) });
    vnc.end();
  });
}
