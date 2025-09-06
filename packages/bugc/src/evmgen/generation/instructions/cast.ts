import type * as Ir from "#ir";
import type { Stack } from "#evm";

import { type Transition, pipe } from "#evmgen/operations";

import { loadValue, storeValueIfNeeded } from "../values/index.js";

/**
 * Generate code for cast instructions
 * Cast is a no-op at the EVM level since types are checked at compile time
 */
export function generateCast<S extends Stack>(
  inst: Ir.CastInstruction,
): Transition<S, readonly ["value", ...S]> {
  // Just load the value and store it with the new type annotation
  return pipe<S>()
    .then(loadValue(inst.value), { as: "value" })
    .then(storeValueIfNeeded(inst.dest))
    .done();
}
