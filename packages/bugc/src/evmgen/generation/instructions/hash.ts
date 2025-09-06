import type * as Ir from "#ir";
import type { Stack } from "#evm";

import { type Transition, pipe, operations } from "#evmgen/operations";

import { loadValue, storeValueIfNeeded } from "../values/index.js";

const { PUSHn, MSTORE, KECCAK256 } = operations;

/**
 * Generate code for hash operations
 */
export function generateHashOp<S extends Stack>(
  inst: Ir.HashInstruction,
): Transition<S, readonly ["value", ...S]> {
  return pipe<S>()
    .then(loadValue(inst.value))
    .then(PUSHn(0n), { as: "offset" })
    .then(MSTORE())
    .then(PUSHn(32n), { as: "size" })
    .then(PUSHn(0n), { as: "offset" })
    .then(KECCAK256(), { as: "value" })
    .then(storeValueIfNeeded(inst.dest))
    .done();
}
