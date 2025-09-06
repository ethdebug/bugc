import type * as Ir from "#ir";
import type { Stack } from "#evm";
import { type Transition, operations, pipe } from "#evmgen/operations";

import { valueId, annotateTop } from "./identify.js";

/**
 * Load a value onto the stack
 */
export const loadValue = <S extends Stack>(
  value: Ir.Value,
): Transition<S, readonly ["value", ...S]> => {
  const { PUSHn, DUPn, MLOAD } = operations;

  const id = valueId(value);

  if (value.kind === "const") {
    return pipe<S>()
      .then(PUSHn(BigInt(value.value)))
      .then(annotateTop(id))
      .done();
  }

  return pipe<S>()
    .peek((state, builder) => {
      // Check if value is on stack
      // Note addition because DUP uses 1-based indexing
      const stackPos =
        state.stack.findIndex(({ irValue }) => irValue === id) + 1;
      if (stackPos > 0 && stackPos <= 16) {
        return builder.then(DUPn(stackPos), { as: "value" });
      }
      // Check if in memory
      if (id in state.memory.allocations) {
        const offset = state.memory.allocations[id].offset;
        return builder
          .then(PUSHn(BigInt(offset)), { as: "offset" })
          .then(MLOAD())
          .then(annotateTop(id));
      }

      throw new Error(`Cannot load value ${id} - not in stack or memory`);
    })
    .done();
};
