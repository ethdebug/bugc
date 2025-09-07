/**
 * Function-level code generation
 */

import * as Ir from "#ir";
import type { Stack } from "#evm";

import type { State } from "#evmgen/state";
import type { Layout, Memory } from "#evmgen/analysis";

import * as Block from "./block.js";
import { serialize } from "../serialize.js";

/**
 * Generate bytecode for a function
 */
export function generate(
  func: Ir.Function,
  memory: Memory.Function.Info,
  layout: Layout.Function.Info,
) {
  const initialState: State<readonly []> = {
    brands: [],
    stack: [],
    instructions: [],
    memory,
    nextId: 0,
    patches: [],
    blockOffsets: {},
    warnings: [],
  };

  const finalState = layout.order.reduce(
    (state: State<Stack>, blockId: string, index: number) => {
      const block = func.blocks.get(blockId);
      if (!block) return state;

      // Determine predecessor for phi resolution
      // This is simplified - real implementation would track actual control flow
      const predecessor = index > 0 ? layout.order[index - 1] : undefined;

      // Check if this is the first or last block
      const isFirstBlock = index === 0;
      const isLastBlock = index === layout.order.length - 1;

      return Block.generate(
        block,
        predecessor,
        isLastBlock,
        isFirstBlock,
      )(state);
    },
    initialState,
  );

  // Patch jump targets
  const patchedState = patchJumps(finalState);

  // Serialize to bytecode
  const bytecode = serialize(patchedState.instructions);

  return {
    instructions: patchedState.instructions,
    bytecode,
    warnings: patchedState.warnings,
  };
}

/**
 * Patch jump targets after all blocks have been generated
 */
function patchJumps<S extends Stack>(state: State<S>): State<S> {
  const patchedInstructions = [...state.instructions];

  for (const patch of state.patches) {
    const targetOffset = state.blockOffsets[patch.target];
    if (targetOffset === undefined) {
      throw new Error(`Jump target ${patch.target} not found`);
    }

    // Convert offset to bytes for PUSH2 (2 bytes, big-endian)
    const highByte = (targetOffset >> 8) & 0xff;
    const lowByte = targetOffset & 0xff;

    // Update the PUSH2 instruction at the patch index
    const instruction = patchedInstructions[patch.index];
    if (instruction && instruction.immediates) {
      instruction.immediates = [highByte, lowByte];
    }
  }

  return {
    ...state,
    instructions: patchedInstructions,
  };
}
