/**
 * Token types, constants, and error class for expression evaluation
 */

/**
 * Expression evaluation error
 */
/** @internal - not re-exported from the package index */
export class ExpressionError extends Error {
  constructor(
    message: string,
    public readonly expression: string
  ) {
    super(message);
    this.name = 'ExpressionError';
  }
}

/**
 * Token types for expression lexer
 */
export type TokenType =
  | 'identifier'
  | 'number'
  | 'string'
  | 'boolean'
  | 'null'
  | 'operator'
  | 'dot'
  | 'lparen'
  | 'rparen'
  | 'lbracket'
  | 'rbracket'
  | 'comma'
  | 'eof';

export interface Token {
  type: TokenType;
  value: string | number | boolean | null;
  raw: string;
}

export const MAX_EXPRESSION_SIZE = 64 * 1024;
export const MAX_EVALUATE_CALLS = 10_000;
export const MAX_PARSE_ACCESS_DEPTH = 128;
export const BLOCKED_PROPERTY_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);
export const COMPARISON_OPERATORS = new Set([
  '==',
  '!=',
  '<',
  '>',
  '<=',
  '>=',
]);
