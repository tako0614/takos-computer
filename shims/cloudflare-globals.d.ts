import type { DurableObjectState as LocalDurableObjectState } from "@takos-computer/common/cf-types";

declare global {
  type DurableObjectState<T = unknown> = LocalDurableObjectState;
}

export {};
