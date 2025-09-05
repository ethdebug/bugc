/**
 * Block-level code generation
 */

import * as Ir from "#ir";
import type { Stack } from "#evm";
import { EvmError, EvmErrorCode } from "../errors.js";
import { type Transition, pipe, operations } from "../operations/index.js";
import { generateInstruction } from "./instruction.js";
import { loadValue } from "./values/index.js";
import { generateTerminator } from "./control-flow/index.js";
import { MEMORY_REGIONS } from "../analysis/memory.js";

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

      let result = builder.then((s) => ({
        ...s,
        blockOffsets: {
          ...s.blockOffsets,
          [block.id]: blockOffset,
        },
      }));

      // Initialize memory for first block
      if (isFirstBlock) {
        // Always initialize the free memory pointer for consistency
        // This ensures dynamic allocations start after static ones
        result = result.then(initializeMemory(state.memory.nextStaticOffset));
      }

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
  return phis
    .reduce(
      (builder, phi) => builder.then(generatePhi(phi, predecessor)),
      pipe<S>(),
    )
    .done();
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

  return (
    pipe<S>()
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
          .then(MSTORE());
      })
      .done()
  );
}

/**
 * Initialize the free memory pointer at runtime
 * Sets the value at 0x40 to the next available memory location after static allocations
 */
function initializeMemory<S extends Stack>(
  nextStaticOffset: number,
): Transition<S, S> {
  const { PUSHn, MSTORE } = operations;

  return (
    pipe<S>()
      // Push the static offset value (the value to store)
      .then(PUSHn(BigInt(nextStaticOffset)), { as: "value" })
      // Push the free memory pointer location (0x40) (the offset)
      .then(PUSHn(BigInt(MEMORY_REGIONS.FREE_MEMORY_POINTER)), { as: "offset" })
      // Store the initial free pointer (expects [value, offset] on stack)
      .then(MSTORE())
      .done()
  );
}
