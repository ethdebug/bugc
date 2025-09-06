import type * as Ir from "#ir";
import type { Stack } from "#evm";
import type { State } from "#evmgen/state";

import { type Transition, pipe, operations } from "#evmgen/operations";

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
      state: State<readonly [...S]>,
    ) => State<readonly [Stack.Brand, ...S]>;
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
