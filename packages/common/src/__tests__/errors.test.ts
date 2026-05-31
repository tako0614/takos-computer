import { expect, test } from "bun:test";

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

test("AppError: code, statusCode, message", () => {
  const err = new AppError("something broke", ErrorCodes.INTERNAL_ERROR, 500);
  expect(err.message).toEqual("something broke");
  expect(err.code).toEqual("INTERNAL_ERROR");
  expect(err.statusCode).toEqual(500);
  expect(err instanceof Error).toBeTruthy();
});

test("AppError: toResponse()", () => {
  const err = new AppError("bad", ErrorCodes.BAD_REQUEST, 400, { field: "x" });
  const resp = err.toResponse();
  expect(resp.error.code).toEqual("BAD_REQUEST");
  expect(resp.error.message).toEqual("bad");
  expect((resp.error.details as { field: string }).field).toEqual("x");
});

test("AppError: toResponse() without details omits details field", () => {
  const err = new AppError("oops", ErrorCodes.INTERNAL_ERROR, 500);
  const resp = err.toResponse();
  expect(resp.error.code).toEqual("INTERNAL_ERROR");
  expect(resp.error.message).toEqual("oops");
  expect(resp.error.details).toEqual(undefined);
});

// ---------- Subclasses ----------

test("BadRequestError: status 400", () => {
  const err = new BadRequestError("invalid input");
  expect(err.statusCode).toEqual(400);
  expect(err.code).toEqual("BAD_REQUEST");
  expect(err.message).toEqual("invalid input");
  expect(err instanceof AppError).toBeTruthy();
});

test("BadRequestError: default message", () => {
  const err = new BadRequestError();
  expect(err.message).toEqual("Bad request");
});

test("AuthenticationError: status 401", () => {
  const err = new AuthenticationError();
  expect(err.statusCode).toEqual(401);
  expect(err.code).toEqual("UNAUTHORIZED");
  expect(err.message).toEqual("Authentication required");
});

test("AuthorizationError: status 403", () => {
  const err = new AuthorizationError();
  expect(err.statusCode).toEqual(403);
  expect(err.code).toEqual("FORBIDDEN");
  expect(err.message).toEqual("Access denied");
});

test("NotFoundError: status 404", () => {
  const err = new NotFoundError("User");
  expect(err.statusCode).toEqual(404);
  expect(err.code).toEqual("NOT_FOUND");
  expect(err.message).toEqual("User not found");
});

test("NotFoundError: default resource name", () => {
  const err = new NotFoundError();
  expect(err.message).toEqual("Resource not found");
});

test("ValidationError: status 422 with field errors", () => {
  const err = new ValidationError("Validation failed", [
    { field: "email", message: "invalid format" },
  ]);
  expect(err.statusCode).toEqual(422);
  expect(err.code).toEqual("VALIDATION_ERROR");
  expect(err.fieldErrors.length).toEqual(1);
  expect(err.fieldErrors[0].field).toEqual("email");
});

test("ConflictError: status 409", () => {
  const err = new ConflictError("duplicate");
  expect(err.statusCode).toEqual(409);
  expect(err.code).toEqual("CONFLICT");
});

test("InternalError: status 500", () => {
  const err = new InternalError();
  expect(err.statusCode).toEqual(500);
  expect(err.code).toEqual("INTERNAL_ERROR");
});

// ---------- isAppError ----------

test("isAppError: returns true for AppError", () => {
  expect(isAppError(new AppError("test"))).toEqual(true);
});

test("isAppError: returns true for subclasses", () => {
  expect(isAppError(new BadRequestError())).toEqual(true);
  expect(isAppError(new NotFoundError())).toEqual(true);
});

test("isAppError: returns false for plain Error", () => {
  expect(isAppError(new Error("test"))).toEqual(false);
});

test("isAppError: returns false for non-error values", () => {
  expect(isAppError("string")).toEqual(false);
  expect(isAppError(null)).toEqual(false);
  expect(isAppError(undefined)).toEqual(false);
  expect(isAppError(42)).toEqual(false);
});

// ---------- normalizeError ----------

test("normalizeError: AppError passes through", () => {
  const original = new BadRequestError("original");
  const normalized = normalizeError(original);
  expect(normalized).toEqual(original);
});

test("normalizeError: plain Error becomes InternalError", () => {
  const normalized = normalizeError(new Error("oops"));
  expect(isAppError(normalized)).toBeTruthy();
  expect(normalized.statusCode).toEqual(500);
  expect(normalized.message).toEqual("An unexpected error occurred");
});

test("normalizeError: string becomes InternalError", () => {
  const normalized = normalizeError("some string");
  expect(isAppError(normalized)).toBeTruthy();
  expect(normalized.statusCode).toEqual(500);
});

test("normalizeError: null becomes InternalError", () => {
  const normalized = normalizeError(null);
  expect(isAppError(normalized)).toBeTruthy();
  expect(normalized.statusCode).toEqual(500);
});

// ---------- getErrorMessage ----------

test("getErrorMessage: extracts Error message", () => {
  expect(getErrorMessage(new Error("test msg"))).toEqual("test msg");
});

test("getErrorMessage: returns string directly", () => {
  expect(getErrorMessage("direct string")).toEqual("direct string");
});

test("getErrorMessage: uses fallback for non-meaningful values", () => {
  expect(getErrorMessage(null, "fallback")).toEqual("fallback");
  expect(getErrorMessage(undefined, "fallback")).toEqual("fallback");
  expect(getErrorMessage("", "fallback")).toEqual("fallback");
  expect(getErrorMessage("  ", "fallback")).toEqual("fallback");
});

test("getErrorMessage: without fallback stringifies value", () => {
  expect(getErrorMessage(42)).toEqual("42");
  expect(getErrorMessage(null)).toEqual("null");
});

test("getErrorMessage: extracts message from object with message property", () => {
  expect(getErrorMessage({ message: "obj msg" })).toEqual("obj msg");
});

test("getErrorMessage: AppError message extracted", () => {
  expect(getErrorMessage(new BadRequestError("bad input"))).toEqual("bad input");
});
