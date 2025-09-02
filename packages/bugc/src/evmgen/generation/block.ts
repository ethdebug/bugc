/**
 * Block-level code generation
 */

import * as Ir from "../../ir";
import type { Stack } from "../../evm";
import { EvmError, EvmErrorCode } from "../errors";
import { type GenState, rebrandTop, operations } from "../operations";
import { generateInstruction } from "./instruction";
import { loadValue, valueId } from "./utils";

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

  const s2 = operations.PUSHn(s1, BigInt(allocation.offset), { brand: "offset" });
  const s3 = operations.MSTORE(s2);
  return s3;
}

/**
 * Generate a terminator (control flow)
 */
function generateTerminator<S extends Stack>(
  state: GenState<readonly [...S]>,
  term: Ir.Terminator,
  isLastBlock: boolean = false,
): GenState<readonly [...S]> {
  switch (term.kind) {
    case "return": {
      if (term.value) {
        // Need to return value from memory
        const id = valueId(term.value);

        // Check if value is in memory
        const allocation = state.memory.allocations[id];
        let offset: number;

        if (allocation === undefined) {
          // Value is on stack, need to store it first
          // Allocate memory for it (simplified - assuming we track free pointer elsewhere)
          offset = state.memory.freePointer;
          const s1 = loadValue(state, term.value);
          const s2 = operations.PUSHn(s1, BigInt(offset), { brand: "offset" });
          const s4 = operations.MSTORE(s2);
          // Now return from that memory location
          const s5 = operations.PUSHn(s4, 32n, { brand: "size" });
          const s6 = operations.PUSHn(s5, BigInt(offset), { brand: "offset" });
          return operations.RETURN(s6);
        } else {
          // Value already in memory, return from there
          offset = allocation.offset;
          const s1 = operations.PUSHn(state, 32n, { brand: "size" });
          const s2 = operations.PUSHn(s1, BigInt(offset), { brand: "offset" });
          return operations.RETURN(s2);
        }
      } else {
        return isLastBlock ? state : operations.STOP(state);
      }
    }

    case "jump": {
      const patchIndex = state.instructions.length;

      // Emit placeholder PUSH2 (0x0000 will be patched later)
      const s1 = operations.PUSH2(state, [0, 0], {
        produces: ["counter"] as const,
      });
      const s2 = operations.JUMP(s1);

      // Record patch location
      return {
        ...s2,
        patches: [
          ...s2.patches,
          {
            index: patchIndex,
            target: term.target,
          },
        ],
      };
    }

    case "branch": {
      // Load condition
      const s1 = rebrandTop(loadValue(state, term.condition), "b");

      // Record offset for true target patch
      const trueIndex = s1.instructions.length;

      // Emit placeholder PUSH2 for true target
      const s2 = operations.PUSH2(s1, [0, 0], {
        produces: ["counter"] as const,
      });
      const s3 = operations.JUMPI(s2);

      // Record offset for false target patch
      const falseIndex = s3.instructions.length;

      // Emit placeholder PUSH2 for false target
      const s4 = operations.PUSH2(s3, [0, 0], {
        produces: ["counter"] as const,
      });
      const s5 = operations.JUMP(s4);

      // Record both patch locations
      return {
        ...s5,
        patches: [
          ...s5.patches,
          {
            index: trueIndex,
            target: term.trueTarget,
          },
          {
            index: falseIndex,
            target: term.falseTarget,
          },
        ],
      };
    }
  }
}
