/**
 * Memory planning error types
 */

import { BugError } from "#errors";
import { Severity } from "#result";
import type { SourceLocation } from "#ast";

export enum MemoryErrorCode {
  STACK_TOO_DEEP = "MEMORY_STACK_TOO_DEEP",
  ALLOCATION_FAILED = "MEMORY_ALLOCATION_FAILED",
  INVALID_LAYOUT = "MEMORY_INVALID_LAYOUT",
}

export class MemoryError extends BugError {
  constructor(
    code: MemoryErrorCode,
    message: string,
    location?: SourceLocation,
  ) {
    super(message, code, location, Severity.Error);
  }
}
