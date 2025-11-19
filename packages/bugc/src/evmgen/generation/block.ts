/**
 * Block-level code generation
 */

import * as Ir from "#ir";
import type { Stack } from "#evm";

import { Error, ErrorCode } from "#evmgen/errors";
import { type Transition, pipe, operations } from "#evmgen/operations";
import { Memory } from "#evmgen/analysis";

import * as Instruction from "./instruction.js";
import { loadValue } from "./values/index.js";
import { generateTerminator } from "./control-flow/index.js";

/**
 * Generate code for a basic block
 */
export function generate<S extends Stack>(
  block: Ir.Block,
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
        result = result
          .then((s) => ({
            ...s,
            currentDebug: inst.operationDebug,
          }))
          .then(Instruction.generate(inst))
          .then((s) => ({
            ...s,
            currentDebug: undefined,
          }));
      }

      // Process terminator
      result = result
        .then((s) => ({
          ...s,
          currentDebug: block.terminator.operationDebug,
        }))
        .then(generateTerminator(block.terminator, isLastBlock))
        .then((s) => ({
          ...s,
          currentDebug: undefined,
        }));

      return result;
    })
    .done();
}

/**
 * Generate code for phi nodes
 */
function generatePhis<S extends Stack>(
  phis: Ir.Block.Phi[],
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
  phi: Ir.Block.Phi,
  predecessor: string,
): Transition<S, S> {
  const { PUSHn, MSTORE } = operations;

  const source = phi.sources.get(predecessor);
  if (!source) {
    throw new Error(
      ErrorCode.PHI_NODE_UNRESOLVED,
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
          throw new Error(
            ErrorCode.MEMORY_ALLOCATION_FAILED,
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
      .then(PUSHn(BigInt(Memory.regions.FREE_MEMORY_POINTER)), { as: "offset" })
      // Store the initial free pointer (expects [value, offset] on stack)
      .then(MSTORE())
      .done()
  );
}
