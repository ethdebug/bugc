/**
 * Allocate instruction code generation
 */

import type * as Ir from "#ir";
import type { Stack } from "#evm";

import { type Transition, pipe } from "#evmgen/operations";
import { allocateMemoryDynamic } from "../memory/index.js";
import { loadValue, storeValueIfNeeded } from "../values/index.js";

/**
 * Generate code for allocate instructions
 * Loads the size value onto the stack, then allocates memory
 */
export function generateAllocate<S extends Stack>(
  inst: Ir.Instruction.Allocate,
): Transition<S, Stack> {
  return (
    pipe<S>()
      // Load the size value onto the stack
      .then(loadValue(inst.size), { as: "size" })
      // Allocate memory using the dynamic allocator
      .then(allocateMemoryDynamic(), { as: "value" })
      // Store the result if needed
      .then(storeValueIfNeeded(inst.dest))
      .done()
  );
}
