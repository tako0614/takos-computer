/**
 * Abstract agent worker base class.
 *
 * Minimal stub extracted to satisfy imports from orchestrator.ts,
 * tool-worker.ts, and delegation-coordinator.ts.
 */

import type { AgentWorkerConfig, AgentMessage } from './types';

export type AgentWorkerStatus = 'idle' | 'initializing' | 'ready' | 'executing' | 'error' | 'shutdown';

export abstract class AbstractAgentWorker<TInput = unknown, TOutput = unknown> {
  protected readonly workerType: string;
  public readonly id: string;
  private _status: AgentWorkerStatus = 'idle';

  constructor(workerType: string, id?: string) {
    this.workerType = workerType;
    this.id = id ?? `${workerType}-${Date.now()}`;
  }

  get status(): AgentWorkerStatus {
    return this._status;
  }

  async initialize(config: AgentWorkerConfig): Promise<void> {
    this._status = 'initializing';
    await this.onInitialize(config);
    this._status = 'ready';
  }

  async execute(input: TInput, signal?: AbortSignal): Promise<TOutput> {
    this._status = 'executing';
    try {
      const result = await this.onExecute(input, signal);
      this._status = 'ready';
      return result;
    } catch (err) {
      this._status = 'error';
      throw err;
    }
  }

  async handleMessage(message: AgentMessage): Promise<unknown> {
    return this.onMessage(message);
  }

  async shutdown(): Promise<void> {
    await this.onShutdown();
    this._status = 'shutdown';
  }

  protected throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }
  }

  protected async executeWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    delayMs = 1000,
  ): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries - 1) {
          await this.sleep(delayMs * Math.pow(2, attempt));
        }
      }
    }
    throw lastError ?? new Error('All retry attempts failed');
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  protected abstract onInitialize(config: AgentWorkerConfig): Promise<void>;
  protected abstract onExecute(input: TInput, signal?: AbortSignal): Promise<TOutput>;
  protected abstract onMessage(message: AgentMessage): Promise<unknown>;
  protected abstract onShutdown(): Promise<void>;
}
