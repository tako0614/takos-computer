/**
 * Multi-agent framework types.
 */

export interface AgentWorkerConfig {
  maxConcurrency?: number;
  timeoutMs?: number;
  [key: string]: unknown;
}

export interface AgentMessage {
  type: string;
  payload?: unknown;
  senderId?: string;
  timestamp?: number;
}
