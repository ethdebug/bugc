import type * as Ir from "#ir";
import type { Stack } from "#evm";

import { type Transition, pipe, operations } from "#evmgen/operations";

import { loadValue, storeValueIfNeeded } from "../values/index.js";

const { PUSHn, SLOAD, SSTORE } = operations;

/**
 * Generate code for the new unified read instruction
 */
export function generateRead<S extends Stack>(
  inst: Ir.Instruction.Read,
): Transition<S, readonly ["value", ...S]> {
  // For now, only handle storage reads
  if (inst.location === "storage" && inst.slot) {
    return pipe<S>()
      .then(loadValue(inst.slot), { as: "key" })
      .then(SLOAD(), { as: "value" })
      .then(storeValueIfNeeded(inst.dest))
      .done();
  }

  // TODO: Handle other locations (memory, calldata, returndata)
  // For unsupported locations, push a dummy value to maintain stack typing
  return pipe<S>().then(PUSHn(0n), { as: "value" }).done();
}

/**
 * Generate code for the new unified write instruction
 */
export function generateWrite<S extends Stack>(
  inst: Ir.Instruction.Write,
): Transition<S, S> {
  // For now, only handle storage writes
  if (inst.location === "storage" && inst.slot && inst.value) {
    return pipe<S>()
      .then(loadValue(inst.value), { as: "value" })
      .then(loadValue(inst.slot), { as: "key" })
      .then(SSTORE())
      .done();
  }

  // TODO: Handle other locations
  return (state) => state;
}
