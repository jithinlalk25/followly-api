import type { JobsOptions } from 'bullmq';

/**
 * Default job options for all queue jobs: retry with exponential backoff.
 * Used when registering queues so every job (email drafts, send campaign emails,
 * send follow-up email) gets the same retry/backoff behavior.
 *
 * - attempts: 3 → up to 3 total runs (1 initial + 2 retries)
 * - backoff: exponential, 5s initial → ~5s, ~10s, ~20s between attempts
 */
export const DEFAULT_JOB_OPTIONS: Pick<
  JobsOptions,
  'attempts' | 'backoff'
> = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000, // ms: 5s, then ~10s, then ~20s
  },
};
