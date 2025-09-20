/**
 * IR instruction code generation - dispatcher
 */

import type * as Ir from "#ir";
import type { Stack } from "#evm";
import { Severity } from "#result";

import { Error, ErrorCode } from "#evmgen/errors";
import type { Transition } from "#evmgen/operations";

import {
  generateBinary,
  generateUnary,
  generateCast,
  generateConst,
  generateEnvOp,
  generateHashOp,
  generateLength,
  generateSlice,
  generateComputeSlot,
  generateRead,
  generateWrite,
} from "./instructions/index.js";

/**
 * Generate code for an IR instruction
 */
export function generate<S extends Stack>(
  inst: Ir.Instruction,
): Transition<S, Stack> {
  switch (inst.kind) {
    case "const":
      return generateConst(inst);
    case "binary":
      return generateBinary(inst);
    case "unary":
      return generateUnary(inst);
    case "read":
      return generateRead(inst);
    case "write":
      return generateWrite(inst);
    case "env":
      return generateEnvOp(inst);
    case "hash":
      return generateHashOp(inst);
    case "length":
      return generateLength(inst);
    case "compute_slot":
      return generateComputeSlot(inst);
    case "cast":
      return generateCast(inst);
    case "slice":
      return generateSlice(inst);
    // Call instruction removed - calls are now block terminators
    case "compute_offset":
    default: {
      return (state) => {
        // Add warning for unsupported instructions
        const warning = new Error(
          ErrorCode.UNSUPPORTED_INSTRUCTION,
          inst.kind,
          inst.loc,
          Severity.Warning,
        );
        return {
          ...state,
          warnings: [...state.warnings, warning],
        };
      };
    }
  }
}
