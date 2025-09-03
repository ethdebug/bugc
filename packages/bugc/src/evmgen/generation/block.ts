/**
 * Block-level code generation
 */

import * as Ir from "../../ir";
import type { Stack } from "../../evm";
import { EvmError, EvmErrorCode } from "../errors";
import { type Transition, pipe, operations } from "../operations";
import { generateInstruction } from "./instruction";
import { loadValue, valueId } from "./utils";

/**
 * Generate code for a basic block
 */
export function generateBlock<S extends Stack>(
  block: Ir.BasicBlock,
  predecessor?: string,
  isLastBlock: boolean = false,
  isFirstBlock: boolean = false,
): Transition<S, Stack> {
  const { JUMPDEST } = operations;

  return pipe<S>()
    .peek((state, builder) => {
      // Record block offset for jump patching
      const blockOffset = state.instructions.length;

      let result = builder
        .then((s) => ({
          ...s,
          blockOffsets: {
            ...s.blockOffsets,
            [block.id]: blockOffset,
          },
        }));

      // Set JUMPDEST for non-first blocks
      if (!isFirstBlock) {
        result = result.then(JUMPDEST());
      }

      // Process phi nodes if we have a predecessor
      if (predecessor && block.phis.length > 0) {
        result = result.then(generatePhis(block.phis, predecessor));
      }

      // Process regular instructions
      for (const inst of block.instructions) {
        result = result.then(generateInstruction(inst));
      }

      // Process terminator
      result = result.then(generateTerminator(block.terminator, isLastBlock));

      return result;
    })
    .done();
}

/**
 * Generate code for phi nodes
 */
function generatePhis<S extends Stack>(
  phis: Ir.PhiInstruction[],
  predecessor: string,
): Transition<S, S> {
  return phis.reduce(
    (builder, phi) => builder.then(generatePhi(phi, predecessor)),
    pipe<S>(),
  ).done();
}

function generatePhi<S extends Stack>(
  phi: Ir.PhiInstruction,
  predecessor: string,
): Transition<S, S> {
  const { PUSHn, MSTORE } = operations;

  const source = phi.sources.get(predecessor);
  if (!source) {
    throw new EvmError(
      EvmErrorCode.PHI_NODE_UNRESOLVED,
      `Phi ${phi.dest} missing source from ${predecessor}`,
    );
  }

  return pipe<S>()
    // Load source value and store to phi destination
    .then(loadValue(source))
    .peek((state, builder) => {
      const allocation = state.memory.allocations[phi.dest];
      if (allocation === undefined) {
        throw new EvmError(
          EvmErrorCode.MEMORY_ALLOCATION_FAILED,
          `Phi destination ${phi.dest} not allocated`,
        );
      }
      return builder
        .then(PUSHn(BigInt(allocation.offset)), { as: "offset" })
        .then(MSTORE())
    })
    .done();
}

/**
 * Generate a terminator (control flow)
 */
function generateTerminator<S extends Stack>(
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
              const offset = state.memory.freePointer;
              return builder
                .then(loadValue(value))
                .then(PUSHn(BigInt(offset)), { as: "offset" })
                .then(MSTORE())
                // Now return from that memory location
                .then(PUSHn(32n), { as: "size" })
                .then(PUSHn(BigInt(offset)), { as: "offset" })
                .then(RETURN());
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
        return isLastBlock
          ? (state) => state
          : pipe<S>().then(STOP()).done();
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
