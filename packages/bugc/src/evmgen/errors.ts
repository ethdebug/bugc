import { BugError } from "#errors";
import type { SourceLocation } from "#ast";
import { Severity } from "#result";

export enum EvmErrorCode {
  STACK_OVERFLOW = "EVM001",
  STACK_UNDERFLOW = "EVM002",
  INVALID_STACK_ACCESS = "EVM003",
  MEMORY_ALLOCATION_FAILED = "EVM004",
  JUMP_TARGET_NOT_FOUND = "EVM005",
  PHI_NODE_UNRESOLVED = "EVM006",
  UNSUPPORTED_INSTRUCTION = "EVM007",
  INTERNAL_ERROR = "EVM999",
}

export const EvmErrorMessages = {
  [EvmErrorCode.STACK_OVERFLOW]: "Stack depth exceeds EVM limit of 1024",
  [EvmErrorCode.STACK_UNDERFLOW]:
    "Stack underflow: attempted to access non-existent stack item",
  [EvmErrorCode.INVALID_STACK_ACCESS]:
    "Invalid stack access: position out of range",
  [EvmErrorCode.MEMORY_ALLOCATION_FAILED]:
    "Failed to allocate memory for value",
  [EvmErrorCode.JUMP_TARGET_NOT_FOUND]: "Jump target block not found",
  [EvmErrorCode.PHI_NODE_UNRESOLVED]:
    "Phi node value not resolved for predecessor",
  [EvmErrorCode.UNSUPPORTED_INSTRUCTION]: "Unsupported IR instruction",
  [EvmErrorCode.INTERNAL_ERROR]: "Internal code generation error",
};

export class EvmError extends BugError {
  constructor(
    code: EvmErrorCode,
    message?: string,
    location?: SourceLocation,
    severity: Severity = Severity.Error,
  ) {
    const baseMessage = EvmErrorMessages[code];
    const fullMessage = message ? `${baseMessage}: ${message}` : baseMessage;
    super(fullMessage, code, location, severity);
  }
}
