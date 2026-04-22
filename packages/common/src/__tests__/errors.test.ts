import { assert, assertEquals } from "@std/assert";
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  BadRequestError,
  ConflictError,
  ErrorCodes,
  getErrorMessage,
  InternalError,
  isAppError,
  normalizeError,
  NotFoundError,
  ValidationError,
} from "../errors.ts";

// ---------- AppError ----------

Deno.test("AppError: code, statusCode, message", () => {
  const err = new AppError("something broke", ErrorCodes.INTERNAL_ERROR, 500);
  assertEquals(err.message, "something broke");
  assertEquals(err.code, "INTERNAL_ERROR");
  assertEquals(err.statusCode, 500);
  assert(err instanceof Error);
});

Deno.test("AppError: toResponse()", () => {
  const err = new AppError("bad", ErrorCodes.BAD_REQUEST, 400, { field: "x" });
  const resp = err.toResponse();
  assertEquals(resp.error.code, "BAD_REQUEST");
  assertEquals(resp.error.message, "bad");
  assertEquals((resp.error.details as { field: string }).field, "x");
});

Deno.test("AppError: toResponse() without details omits details field", () => {
  const err = new AppError("oops", ErrorCodes.INTERNAL_ERROR, 500);
  const resp = err.toResponse();
  assertEquals(resp.error.code, "INTERNAL_ERROR");
  assertEquals(resp.error.message, "oops");
  assertEquals(resp.error.details, undefined);
});

// ---------- Subclasses ----------

Deno.test("BadRequestError: status 400", () => {
  const err = new BadRequestError("invalid input");
  assertEquals(err.statusCode, 400);
  assertEquals(err.code, "BAD_REQUEST");
  assertEquals(err.message, "invalid input");
  assert(err instanceof AppError);
});

Deno.test("BadRequestError: default message", () => {
  const err = new BadRequestError();
  assertEquals(err.message, "Bad request");
});

Deno.test("AuthenticationError: status 401", () => {
  const err = new AuthenticationError();
  assertEquals(err.statusCode, 401);
  assertEquals(err.code, "UNAUTHORIZED");
  assertEquals(err.message, "Authentication required");
});

Deno.test("AuthorizationError: status 403", () => {
  const err = new AuthorizationError();
  assertEquals(err.statusCode, 403);
  assertEquals(err.code, "FORBIDDEN");
  assertEquals(err.message, "Access denied");
});

Deno.test("NotFoundError: status 404", () => {
  const err = new NotFoundError("User");
  assertEquals(err.statusCode, 404);
  assertEquals(err.code, "NOT_FOUND");
  assertEquals(err.message, "User not found");
});

Deno.test("NotFoundError: default resource name", () => {
  const err = new NotFoundError();
  assertEquals(err.message, "Resource not found");
});

Deno.test("ValidationError: status 422 with field errors", () => {
  const err = new ValidationError("Validation failed", [
    { field: "email", message: "invalid format" },
  ]);
  assertEquals(err.statusCode, 422);
  assertEquals(err.code, "VALIDATION_ERROR");
  assertEquals(err.fieldErrors.length, 1);
  assertEquals(err.fieldErrors[0].field, "email");
});

Deno.test("ConflictError: status 409", () => {
  const err = new ConflictError("duplicate");
  assertEquals(err.statusCode, 409);
  assertEquals(err.code, "CONFLICT");
});

Deno.test("InternalError: status 500", () => {
  const err = new InternalError();
  assertEquals(err.statusCode, 500);
  assertEquals(err.code, "INTERNAL_ERROR");
});

// ---------- isAppError ----------

Deno.test("isAppError: returns true for AppError", () => {
  assertEquals(isAppError(new AppError("test")), true);
});

Deno.test("isAppError: returns true for subclasses", () => {
  assertEquals(isAppError(new BadRequestError()), true);
  assertEquals(isAppError(new NotFoundError()), true);
});

Deno.test("isAppError: returns false for plain Error", () => {
  assertEquals(isAppError(new Error("test")), false);
});

Deno.test("isAppError: returns false for non-error values", () => {
  assertEquals(isAppError("string"), false);
  assertEquals(isAppError(null), false);
  assertEquals(isAppError(undefined), false);
  assertEquals(isAppError(42), false);
});

// ---------- normalizeError ----------

Deno.test("normalizeError: AppError passes through", () => {
  const original = new BadRequestError("original");
  const normalized = normalizeError(original);
  assertEquals(normalized, original);
});

Deno.test("normalizeError: plain Error becomes InternalError", () => {
  const normalized = normalizeError(new Error("oops"));
  assert(isAppError(normalized));
  assertEquals(normalized.statusCode, 500);
  assertEquals(normalized.message, "An unexpected error occurred");
});

Deno.test("normalizeError: string becomes InternalError", () => {
  const normalized = normalizeError("some string");
  assert(isAppError(normalized));
  assertEquals(normalized.statusCode, 500);
});

Deno.test("normalizeError: null becomes InternalError", () => {
  const normalized = normalizeError(null);
  assert(isAppError(normalized));
  assertEquals(normalized.statusCode, 500);
});

// ---------- getErrorMessage ----------

Deno.test("getErrorMessage: extracts Error message", () => {
  assertEquals(getErrorMessage(new Error("test msg")), "test msg");
});

Deno.test("getErrorMessage: returns string directly", () => {
  assertEquals(getErrorMessage("direct string"), "direct string");
});

Deno.test("getErrorMessage: uses fallback for non-meaningful values", () => {
  assertEquals(getErrorMessage(null, "fallback"), "fallback");
  assertEquals(getErrorMessage(undefined, "fallback"), "fallback");
  assertEquals(getErrorMessage("", "fallback"), "fallback");
  assertEquals(getErrorMessage("  ", "fallback"), "fallback");
});

Deno.test("getErrorMessage: without fallback stringifies value", () => {
  assertEquals(getErrorMessage(42), "42");
  assertEquals(getErrorMessage(null), "null");
});

Deno.test("getErrorMessage: extracts message from object with message property", () => {
  assertEquals(getErrorMessage({ message: "obj msg" }), "obj msg");
});

Deno.test("getErrorMessage: AppError message extracted", () => {
  assertEquals(
    getErrorMessage(new BadRequestError("bad input")),
    "bad input",
  );
});
