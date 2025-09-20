import type * as Ir from "#ir";

import type { Stack } from "#evm";

import { type Transition, pipe, operations } from "#evmgen/operations";

import { loadValue, storeValueIfNeeded } from "../values/index.js";

const { PUSHn, MSTORE, KECCAK256, ADD } = operations;

/**
 * Generate code for computing a storage slot based on kind
 */
export function generateComputeSlot<S extends Stack>(
  inst: Ir.Instruction.ComputeSlot,
): Transition<S, readonly ["value", ...S]> {
  switch (inst.slotKind) {
    case "mapping":
      // For mappings: keccak256(key || baseSlot)
      if (!inst.key) {
        throw new Error("Mapping compute_slot requires key");
      }
      return (
        pipe<S>()
          // store key then base in memory as 32 bytes each
          .then(loadValue(inst.key))
          .then(PUSHn(0n), { as: "offset" })
          .then(MSTORE())

          .then(loadValue(inst.base))
          .then(PUSHn(32n), { as: "offset" })
          .then(MSTORE())
          .then(PUSHn(64n), { as: "size" })
          .then(PUSHn(0n), { as: "offset" })
          .then(KECCAK256(), { as: "value" })
          .then(storeValueIfNeeded(inst.dest))
          .done()
      );

    case "array":
      // For arrays: keccak256(base)
      return (
        pipe<readonly [...S]>()
          // Store base at memory offset 0
          .then(loadValue(inst.base))
          .then(PUSHn(0n), { as: "offset" })
          .then(MSTORE())

          // Hash 32 bytes starting at offset 0
          .then(PUSHn(32n), { as: "size" })
          .then(PUSHn(0n), { as: "offset" })
          .then(KECCAK256(), { as: "value" })
          .then(storeValueIfNeeded(inst.dest))
          .done()
      );

    case "field": {
      // For struct fields: base + (fieldOffset / 32) to get the slot
      if (inst.fieldOffset === undefined) {
        throw new Error("Field compute_slot requires fieldOffset");
      }
      // Convert byte offset to slot offset
      const slotOffset = Math.floor(inst.fieldOffset / 32);
      return pipe<S>()
        .then(loadValue(inst.base), { as: "b" })
        .then(PUSHn(BigInt(slotOffset)), { as: "a" })
        .then(ADD(), { as: "value" })
        .then(storeValueIfNeeded(inst.dest))
        .done();
    }

    default:
      throw new Error(`Unknown compute_slot kind: ${inst.slotKind}`);
  }
}
