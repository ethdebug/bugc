/**
 * Parser-specific errors and error codes
 */

import { BugError } from "#errors";
import type { SourceLocation } from "#ast";

/**
 * Parse errors
 */
export class Error extends BugError {
  public readonly expected?: string[];

  constructor(message: string, location: SourceLocation, expected?: string[]) {
    super(message, "PARSE_ERROR", location);
    this.expected = expected;
  }
}
