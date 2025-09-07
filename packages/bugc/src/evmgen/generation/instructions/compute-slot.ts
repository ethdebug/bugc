import type * as Ir from "#ir";

import type { Stack } from "#evm";

import { type Transition, pipe, operations } from "#evmgen/operations";

import { loadValue, storeValueIfNeeded } from "../values/index.js";

const { PUSHn, MSTORE, KECCAK256 } = operations;

/**
 * Generate code for computing a mapping slot
 */
export function generateComputeSlot<S extends Stack>(
  inst: Ir.Instruction.ComputeSlot,
): Transition<S, readonly ["value", ...S]> {
  return (
    pipe<S>()
      // store key then baseSlot in memory as 32 bytes each
      .then(loadValue(inst.key))
      .then(PUSHn(0n), { as: "offset" })
      .then(MSTORE())

      .then(loadValue(inst.baseSlot))
      .then(PUSHn(32n), { as: "offset" })
      .then(MSTORE())
      .then(PUSHn(64n), { as: "size" })
      .then(PUSHn(0n), { as: "offset" })
      .then(KECCAK256(), { as: "value" })
      .then(storeValueIfNeeded(inst.dest))
      .done()
  );
}

/**
 * Generate code for computing an array slot
 */
export function generateComputeArraySlot<S extends Stack>(
  inst: Ir.Instruction.ComputeArraySlot,
): Transition<S, readonly ["value", ...S]> {
  // For arrays: keccak256(baseSlot)
  return (
    pipe<readonly [...S]>()
      // Store baseSlot at memory offset 0
      .then(loadValue(inst.baseSlot))
      .then(PUSHn(0n), { as: "offset" })
      .then(MSTORE())

      // Hash 32 bytes starting at offset 0
      .then(PUSHn(32n), { as: "size" })
      .then(PUSHn(0n), { as: "offset" })
      .then(KECCAK256(), { as: "value" })
      .then(storeValueIfNeeded(inst.dest))
      .done()
  );
}
