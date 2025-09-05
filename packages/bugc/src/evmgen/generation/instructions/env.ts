import type * as Ir from "#ir";
import type { Stack, StackBrand } from "#evm";
import type { GenState, Transition } from "../../operations/index.js";

import { pipe, operations } from "../../operations/index.js";
import { storeValueIfNeeded } from "../values/index.js";

const { CALLER, CALLVALUE, PUSH0, TIMESTAMP, NUMBER } = operations;

/**
 * Generate code for environment operations
 */
export function generateEnvOp<S extends Stack>(
  inst: Ir.EnvInstruction,
): Transition<S, readonly ["value", ...S]> {
  const map: {
    [O in Ir.EnvOp]: <S extends Stack>(
      state: GenState<readonly [...S]>,
    ) => GenState<readonly [StackBrand, ...S]>;
  } = {
    msg_sender: CALLER(),
    msg_value: CALLVALUE(),
    msg_data: PUSH0(), // Returns calldata offset (0)
    block_timestamp: TIMESTAMP(),
    block_number: NUMBER(),
  };

  return pipe<S>()
    .then(map[inst.op], { as: "value" })
    .then(storeValueIfNeeded(inst.dest))
    .done();
}
