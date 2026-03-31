/**
 * Type definitions for step execution
 */
import type { Step, ActionResolver } from '../types.ts';

/**
 * Step runner options
 */
export interface StepRunnerOptions {
  /** Custom action resolver */
  actionResolver?: ActionResolver;
  /** Custom shell command executor */
  shellExecutor?: ShellExecutor;
  /** Default timeout in minutes */
  defaultTimeout?: number;
  /** Working directory */
  workingDirectory?: string;
  /** Default shell */
  defaultShell?: Step['shell'];
}

/**
 * Metadata for step execution
 */
export interface StepRunMetadata {
  /** Zero-based step index within its job */
  index?: number;
}

/**
 * Shell executor function type
 */
export type ShellExecutor = (
  command: string,
  options: ShellExecutorOptions
) => Promise<ShellExecutorResult>;

/**
 * Shell executor options
 */
export interface ShellExecutorOptions {
  shell?: Step['shell'];
  workingDirectory?: string;
  env?: Record<string, string>;
  timeout?: number;
}

/**
 * Shell executor result
 */
export interface ShellExecutorResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface StepCommandFiles {
  directory: string;
  env: string;
  output: string;
  path: string;
}
