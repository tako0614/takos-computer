/**
 * @takos/common - Shared utilities for Takos services
 *
 * This package provides common utilities used across all takos packages:
 * - ID generation (generateId)
 * - Validation helpers (isLocalhost, isPrivateIP)
 * - Error handling (AppError, ValidationError, etc.)
 * - Structured logging (createLogger)
 * - Hono middleware
 */

// =============================================================================
// ID Generation Utilities
// =============================================================================
export { generateId } from "./id.ts";

// =============================================================================
// Validation Utilities
// =============================================================================
export { isLocalhost, isPrivateIP } from "./validation.ts";

// =============================================================================
// Structured Logging
// =============================================================================
export { createLogger, type Logger, type LogLevel } from "./logger.ts";

// =============================================================================
// Cloudflare Workers type shims (for Node.js environments)
// =============================================================================
export type {
  Ai,
  D1Database,
  D1ExecResult,
  D1PreparedStatement,
  D1RawOptions,
  D1Result,
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectState,
  DurableObjectStorage,
  DurableObjectStub,
  Fetcher,
  KVNamespace,
  Queue,
  QueueSendOptions,
  R2Bucket,
  R2ListOptions,
  R2Object,
  R2ObjectMetadata,
  R2Objects,
  R2PutOptions,
  VectorizeIndex,
  VectorizeMatch,
  VectorizeQueryOptions,
  VectorizeQueryResult,
  VectorizeVector,
} from "./cf-types.ts";

// =============================================================================
// Error Handling
// =============================================================================
export {
  // Base errors
  AppError,
  AuthenticationError,
  AuthorizationError,
  BadGatewayError,
  // HTTP errors
  BadRequestError,
  ConflictError,
  type ErrorCode,
  // Error codes
  ErrorCodes,
  // Types
  type ErrorResponse,
  GatewayTimeoutError,
  getErrorMessage,
  GoneError,
  InternalError,
  // Utility functions
  isAppError,
  logError,
  normalizeError,
  NotFoundError,
  NotImplementedError,
  PayloadTooLargeError,
  PaymentRequiredError,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
  type ValidationErrorDetail,
} from "./errors.ts";
