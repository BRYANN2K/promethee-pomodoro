import type { SnapshotWarningCode } from "./types.ts";

export type StoreFailureCode =
  | "READ_FAILED"
  | "CANDIDATE_WRITE_FAILED"
  | "REPLACEMENT_FAILED"
  | "QUARANTINE_FAILED";

export interface StoreFailure {
  readonly code: StoreFailureCode;
  readonly message: string;
}

export type StoreReadResult =
  | { readonly kind: "missing" }
  | { readonly kind: "found"; readonly serialized: string }
  | { readonly kind: "failed"; readonly failure: StoreFailure };

export type StoreReplaceResult =
  | { readonly kind: "committed" }
  | { readonly kind: "failed"; readonly failure: StoreFailure };

export type StoreQuarantineResult =
  | { readonly kind: "quarantined"; readonly retainedCopies: 0 | 1 }
  | { readonly kind: "failed"; readonly failure: StoreFailure };

export interface StoreQuarantineRequest {
  readonly reason: SnapshotWarningCode;
  readonly maxRetainedCopies: 1;
}

/**
 * Abstract persistence boundary only. An implementation must document its own
 * durability and replacement guarantees; this contract does not select a path,
 * filesystem primitive, database, or platform adapter.
 */
export interface CycleSnapshotStorePort {
  readCurrent(): Promise<StoreReadResult>;
  replaceCurrent(candidate: string): Promise<StoreReplaceResult>;
  quarantineCurrent(request: StoreQuarantineRequest): Promise<StoreQuarantineResult>;
}
