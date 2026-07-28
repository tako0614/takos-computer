/**
 * Cloudflare Workers type definitions used by container hosts.
 *
 * Canonical definitions live in @takos-computer/common/cf-types.
 * This module re-exports the subset the hosts use for local import convenience.
 */
export type {
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectState,
  DurableObjectStorage,
  DurableObjectStorageTransaction,
  DurableObjectStub,
  KVNamespace,
} from "@takos-computer/common/cf-types";
