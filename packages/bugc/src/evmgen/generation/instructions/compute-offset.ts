/**
 * Compute offset instruction code generation
 */

import * as Ir from "#ir";
import type { Stack } from "#evm";

import { type Transition, pipe, rebrand, operations } from "#evmgen/operations";
import { loadValue, storeValueIfNeeded } from "../values/index.js";

const { MUL, ADD } = operations;

/**
 * Generate code for compute_offset instructions
 * Computes: base + (index * stride) + byteOffset/fieldOffset
 */
export function generateComputeOffset<S extends Stack>(
  inst: Ir.Instruction.ComputeOffset,
): Transition<S, readonly ["value", ...S]> {
  // For now, handle memory/calldata/returndata the same way
  // The location property may matter for future optimizations or bounds checking

  // Handle index-based offset (for arrays)
  if (inst.index !== undefined) {
    return (
      pipe<S>()
        // Load base address
        .then(loadValue(inst.base), { as: "base" })
        .then(loadValue(inst.index), { as: "index" })
        // Load stride if we have an index
        .then(
          loadValue(
            Ir.Value.constant(BigInt(inst.stride ?? 32), {
              kind: "uint",
              bits: 256,
            }),
          ),
          { as: "stride" },
        )
        .then(rebrand<"stride", "a", "index", "b">({ 1: "a", 2: "b" }))
        // Compute index * stride
        .then(MUL(), { as: "scaled_index" })
        // Add to base
        .then(rebrand<"scaled_index", "a", "base", "b">({ 1: "a", 2: "b" }))
        .then(ADD(), { as: "value" })
        // Store the result
        .then(storeValueIfNeeded(inst.dest))
        .done()
    );
  }

  // Handle field offset (for structs)
  if (inst.fieldOffset !== undefined && inst.fieldOffset !== 0) {
    return (
      pipe<S>()
        // Load base address
        .then(loadValue(inst.base), { as: "base" })
        .then(
          loadValue(
            Ir.Value.constant(BigInt(inst.fieldOffset), {
              kind: "uint",
              bits: 256,
            }),
          ),
          { as: "field_offset" },
        )
        .then(rebrand<"field_offset", "a", "base", "b">({ 1: "a", 2: "b" }))
        .then(ADD(), { as: "value" })
        // Store the result
        .then(storeValueIfNeeded(inst.dest))
        .done()
    );
  }

  // Handle byte offset
  if (inst.byteOffset !== undefined) {
    return (
      pipe<S>()
        // Load base address
        .then(loadValue(inst.base), { as: "base" })
        .then(loadValue(inst.byteOffset), { as: "byte_offset" })
        .then(rebrand<"byte_offset", "a", "base", "b">({ 1: "a", 2: "b" }))
        .then(ADD(), { as: "value" })
        // Store the result
        .then(storeValueIfNeeded(inst.dest))
        .done()
    );
  }

  // default case TODO investigate whether this is wrong
  return (
    pipe<S>()
      // Load base address
      .then(loadValue(inst.base), { as: "value" })
      // Store the result
      .then(storeValueIfNeeded(inst.dest))
      .done()
  );
}
