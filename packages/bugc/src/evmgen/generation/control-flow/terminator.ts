import type * as Ir from "../../../ir";
import type { Stack } from "../../../evm";
import type { Transition } from "../../operations";

import { operations, pipe } from "../../operations";
import { valueId, loadValue } from "../values";

/**
 * Generate code for a block terminator
 */
export function generateTerminator<S extends Stack>(
  term: Ir.Terminator,
  isLastBlock: boolean = false,
): Transition<S, S> {
  const { PUSHn, PUSH2, MSTORE, RETURN, STOP, JUMP, JUMPI } = operations;

  switch (term.kind) {
    case "return": {
      if (term.value) {
        // Need to return value from memory
        const value = term.value; // Capture for closure
        const id = valueId(value);

        return pipe<S>()
          .peek((state, builder) => {
            // Check if value is in memory
            const allocation = state.memory.allocations[id];

            if (allocation === undefined) {
              // Value is on stack, need to store it first
              // Allocate memory for it (simplified - assuming we track free pointer elsewhere)
              const offset = state.memory.nextStaticOffset;
              return (
                builder
                  .then(loadValue(value))
                  .then(PUSHn(BigInt(offset)), { as: "offset" })
                  .then(MSTORE())
                  // Now return from that memory location
                  .then(PUSHn(32n), { as: "size" })
                  .then(PUSHn(BigInt(offset)), { as: "offset" })
                  .then(RETURN())
              );
            } else {
              // Value already in memory, return from there
              const offset = allocation.offset;
              return builder
                .then(PUSHn(32n), { as: "size" })
                .then(PUSHn(BigInt(offset)), { as: "offset" })
                .then(RETURN());
            }
          })
          .done();
      } else {
        return isLastBlock ? (state) => state : pipe<S>().then(STOP()).done();
      }
    }

    case "jump": {
      return pipe<S>()
        .peek((state, builder) => {
          const patchIndex = state.instructions.length;

          return builder
            .then(PUSH2([0, 0]), { as: "counter" })
            .then(JUMP())
            .then((newState) => ({
              ...newState,
              patches: [
                ...newState.patches,
                {
                  index: patchIndex,
                  target: term.target,
                },
              ],
            }));
        })
        .done();
    }

    case "branch": {
      return pipe<S>()
        .then(loadValue(term.condition), { as: "b" })
        .peek((state, builder) => {
          // Record offset for true target patch
          const trueIndex = state.instructions.length;

          return builder
            .then(PUSH2([0, 0]), { as: "counter" })
            .then(JUMPI())
            .peek((state2, builder2) => {
              // Record offset for false target patch
              const falseIndex = state2.instructions.length;

              return builder2
                .then(PUSH2([0, 0]), { as: "counter" })
                .then(JUMP())
                .then((finalState) => ({
                  ...finalState,
                  patches: [
                    ...finalState.patches,
                    {
                      index: trueIndex,
                      target: term.trueTarget,
                    },
                    {
                      index: falseIndex,
                      target: term.falseTarget,
                    },
                  ],
                }));
            });
        })
        .done();
    }
  }
}
