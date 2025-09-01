/**
 * Function-level code generation
 */

import * as Ir from "../../ir";
import type { Stack } from "../../evm";
import type { GenState } from "../operations/state";
import type { FunctionBlockLayout } from "../analysis/layout";
import type { FunctionMemoryLayout } from "../analysis/memory";
import { generateBlock } from "./block";
import { serialize } from "../serialize";

/**
 * Generate bytecode for a function
 */
export function generateFunction(
  func: Ir.IrFunction,
  memory: FunctionMemoryLayout,
  layout: FunctionBlockLayout,
) {
  const initialState: GenState<readonly []> = {
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
    (state: GenState<Stack>, blockId: string, index: number) => {
      const block = func.blocks.get(blockId);
      if (!block) return state;

      // Determine predecessor for phi resolution
      // This is simplified - real implementation would track actual control flow
      const predecessor = index > 0 ? layout.order[index - 1] : undefined;

      // Check if this is the first or last block
      const isFirstBlock = index === 0;
      const isLastBlock = index === layout.order.length - 1;

      return generateBlock(
        state,
        block,
        predecessor,
        isLastBlock,
        isFirstBlock,
      );
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
export function patchJumps<S extends Stack>(state: GenState<S>): GenState<S> {
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
