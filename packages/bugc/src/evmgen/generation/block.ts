/**
 * Block-level code generation
 */

import * as Ir from "../../ir";
import type { Stack } from "../../evm";
import { EvmError, EvmErrorCode } from "../errors";
import type { GenState } from "../operations/state";
import { operations } from "../operations/operations";
import { emitPush } from "../operations/push";
import { generateInstruction, generateTerminator } from "./instruction";
import { loadValue } from "./utils";

/**
 * Generate code for a basic block
 */
export function generateBlock<S extends Stack>(
  state: GenState<S>,
  block: Ir.BasicBlock,
  predecessor?: string,
  isLastBlock: boolean = false,
  isFirstBlock: boolean = false,
): GenState<Stack> {
  // Record block offset for jump patching
  const blockOffset = state.instructions.length;
  let currentState = {
    ...state,
    blockOffsets: {
      ...state.blockOffsets,
      [block.id]: blockOffset,
    },
  } as GenState<Stack>;

  // Set JUMPDEST for non-first blocks
  if (!isFirstBlock) {
    currentState = operations.JUMPDEST(currentState) as GenState<Stack>;
  }

  // Process phi nodes if we have a predecessor
  if (predecessor && block.phis.length > 0) {
    currentState = generatePhis(
      currentState,
      block.phis,
      predecessor,
    ) as GenState<Stack>;
  }

  // Process regular instructions
  for (const inst of block.instructions) {
    currentState = generateInstruction(currentState, inst) as GenState<Stack>;
  }

  // Process terminator
  currentState = generateTerminator(
    currentState,
    block.terminator,
    isLastBlock,
  ) as GenState<Stack>;

  return currentState;
}

/**
 * Generate code for phi nodes
 */
function generatePhis<S extends Stack>(
  state: GenState<readonly [...S]>,
  phis: Ir.PhiInstruction[],
  predecessor: string,
) {
  return phis.reduce(
    (state, phi) => generatePhi(state, phi, predecessor),
    state,
  );
}

function generatePhi<S extends Stack>(
  state: GenState<readonly [...S]>,
  phi: Ir.PhiInstruction,
  predecessor: string,
): GenState<readonly [...S]> {
  const source = phi.sources.get(predecessor);
  if (!source) {
    throw new EvmError(
      EvmErrorCode.PHI_NODE_UNRESOLVED,
      `Phi ${phi.dest} missing source from ${predecessor}`,
    );
  }

  // Load source value and store to phi destination
  const s1 = loadValue(state, source);
  const allocation = state.memory.allocations[phi.dest];
  if (allocation === undefined) {
    throw new EvmError(
      EvmErrorCode.MEMORY_ALLOCATION_FAILED,
      `Phi destination ${phi.dest} not allocated`,
    );
  }

  const s2 = emitPush(s1, BigInt(allocation.offset), { brand: "offset" });
  const s3 = operations.MSTORE(s2);
  return s3;
}
