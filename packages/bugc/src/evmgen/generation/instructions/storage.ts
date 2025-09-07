import type * as Ir from "#ir";
import type { Stack } from "#evm";

import { type Transition, pipe, operations } from "#evmgen/operations";

import { loadValue, storeValueIfNeeded } from "../values/index.js";

const { PUSHn, SLOAD, SSTORE, MSTORE, KECCAK256 } = operations;

/**
 * Generate code for loading from storage
 */
export function generateLoadStorage<S extends Stack>(
  inst: Ir.Instruction.LoadStorage,
): Transition<S, readonly ["value", ...S]> {
  return pipe<S>()
    .then(loadValue(inst.slot), { as: "key" })
    .then(SLOAD(), { as: "value" })
    .then(storeValueIfNeeded(inst.dest))
    .done();
}

/**
 * Generate code for storing to storage
 */
export function generateStoreStorage<S extends Stack>(
  inst: Ir.Instruction.StoreStorage,
): Transition<S, S> {
  return pipe<S>()
    .then(loadValue(inst.value), { as: "value" })
    .then(loadValue(inst.slot), { as: "key" })
    .then(SSTORE())
    .done();
}

/**
 * Generate code for loading from a mapping
 */
export function generateLoadMapping<S extends Stack>(
  inst: Ir.Instruction.LoadMapping,
): Transition<S, readonly ["value", ...S]> {
  return (
    pipe<S>()
      // Store key at scratch space offset 0
      .then(loadValue(inst.key))
      .then(PUSHn(0n), { as: "offset" })
      .then(MSTORE())

      // Store mapping slot at scratch space offset 32
      .then(PUSHn(BigInt(inst.slot)))
      .then(PUSHn(32n), { as: "offset" })
      .then(MSTORE())

      // Hash 64 bytes to get storage location: keccak256(key . slot)
      .then(PUSHn(64n), { as: "size" })
      .then(PUSHn(0n), { as: "offset" })
      .then(KECCAK256(), { as: "key" })

      // Load value from computed storage slot
      .then(SLOAD(), { as: "value" })
      .then(storeValueIfNeeded(inst.dest))
      .done()
  );
}

/**
 * Generate code for storing to a mapping
 */
export function generateStoreMapping<S extends Stack>(
  inst: Ir.Instruction.StoreMapping,
): Transition<S, S> {
  return (
    pipe<S>()
      // Store key at scratch space offset 0
      .then(loadValue(inst.key))
      .then(PUSHn(0n), { as: "offset" })
      .then(MSTORE())

      // Store mapping slot at scratch space offset 32
      .then(PUSHn(BigInt(inst.slot)))
      .then(PUSHn(32n), { as: "offset" })
      .then(MSTORE())

      // Load value first (will be second on stack)
      .then(loadValue(inst.value), { as: "value" })

      // Hash 64 bytes to get storage location: keccak256(key . slot)
      .then(PUSHn(64n), { as: "size" })
      .then(PUSHn(0n), { as: "offset" })
      .then(KECCAK256(), { as: "key" })

      // Now we have [key, value, ...] on stack, which SSTORE expects
      .then(SSTORE())
      .done()
  );
}
