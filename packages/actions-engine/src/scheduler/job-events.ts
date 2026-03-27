/**
 * Job scheduler event types and listener definitions
 */
import type { Job, JobResult } from '../types.js';

/**
 * Job scheduler event types
 */
export type JobSchedulerEvent =
  | { type: 'job:start'; jobId: string; job: Job }
  | { type: 'job:complete'; jobId: string; result: JobResult }
  | { type: 'job:skip'; jobId: string; reason: string; result: JobResult }
  | { type: 'phase:start'; phase: number; jobs: string[] }
  | { type: 'phase:complete'; phase: number }
  | { type: 'workflow:start'; phases: string[][] }
  | { type: 'workflow:complete'; results: Record<string, JobResult> };

/**
 * Job scheduler event listener
 */
export type JobSchedulerListener = (event: JobSchedulerEvent) => void;
