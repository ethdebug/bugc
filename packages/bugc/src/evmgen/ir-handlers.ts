/**
 * IR Instruction handlers with strongly-typed state management
 */

import * as Ir from "../ir";
import type { Stack, StackBrand } from "../evm";
import { EvmError, EvmErrorCode } from "./errors";
import { Severity } from "../result";
import type { GenState } from "./state";
import { rebrandTop, operations } from "./operations";
import { emitPush } from "./push";
import { emitDup } from "./dup";
import { serialize, calculateSize } from "./serialize";
import type { FunctionBlockLayout } from "../memory/block-layout";
import type { FunctionMemoryLayout } from "../memory/memory-planner";

/**
 * Get the ID for a value
 */
function valueId(val: Ir.Value): string {
  if (val.kind === "const") {
    // Constants don't have stable IDs, we'll handle them specially
    return `$const_${val.value}`;
  } else if (val.kind === "temp") {
    return val.id;
  } else {
    return val.name;
  }
}

/**
 * Annotate the top stack item with an IR value
 */
function annotateTop<S extends Stack>(
  state: GenState<S>,
  irValue: string,
): GenState<S> {
  if (state.stack.length === 0) {
    throw new Error("Cannot annotate empty stack");
  }

  const newStack = [...state.stack];
  newStack[0] = {
    ...newStack[0],
    irValue,
  };

  return {
    ...state,
    stack: newStack,
  };
}

/**
 * Load an IR value onto the stack
 */
function loadValue<S extends Stack>(
  state: GenState<S>,
  value: Ir.Value,
): GenState<readonly ["value", ...S]> {
  const id = valueId(value);

  if (value.kind === "const") {
    // Push constant directly and annotate it
    const newState = emitPush(state, BigInt(value.value));
    return annotateTop(newState, id);
  }

  // Check if value is on stack
  // Note addition because DUP uses 1-based indexing
  const stackPos = state.stack.findIndex(({ irValue }) => irValue === id) + 1;
  if (stackPos > 0 && stackPos <= 16) {
    // Cast is safe - we know DUP produces an item and we're rebranding it to "value"
    return rebrandTop(emitDup(state, stackPos), "value");
  }

  // Check if in memory
  if (id in state.memory.allocations) {
    const offset = state.memory.allocations[id].offset;
    const s1 = emitPush(state, BigInt(offset), { brand: "offset" });
    const s2 = operations.MLOAD(s1);
    // Annotate the loaded value
    return annotateTop(s2, id);
  }

  throw new Error(`Cannot load value ${id} - not in stack or memory`);
}

/**
 * Store a value to memory if allocated
 * Assumes the value is already on top of stack
 */
function storeValueIfNeeded<S extends Stack>(
  state: GenState<readonly ["value", ...S]>,
  destId: string,
): GenState<readonly ["value", ...S]> {
  // First annotate the top value with the destination ID
  const s0 = annotateTop(state, destId);

  const allocation = state.memory.allocations[destId];
  if (allocation === undefined) {
    return s0;
  }

  const s1 = emitPush(s0, BigInt(allocation.offset), { brand: "offset" });
  const s2 = operations.DUP2(s1);
  const s3 = operations.SWAP1(s2);
  return operations.MSTORE(s3);
}

/**
 * Generate a binary operation
 */
export function generateBinary<S extends Stack>(
  state: GenState<S>,
  inst: Ir.BinaryOpInstruction,
): GenState<readonly ["value", ...S]> {
  const s1 = rebrandTop(loadValue(state, inst.left), "b");
  const s2 = rebrandTop(loadValue(s1, inst.right), "a");

  const map: {
    [O in Ir.BinaryOp]: <S extends Stack>(
      state: GenState<readonly ["a", "b", ...S]>,
    ) => GenState<readonly [StackBrand, ...S]>;
  } = {
    add: operations.ADD,
    sub: operations.SUB,
    mul: operations.MUL,
    div: operations.DIV,
    mod: operations.MOD,
    eq: operations.EQ,
    ne: (state) =>
      operations.NOT(operations.EQ(state, { produces: ["a"] as const })),
    lt: operations.LT,
    le: (state) =>
      operations.NOT(operations.GT(state, { produces: ["a"] as const })),
    gt: operations.GT,
    ge: (state) =>
      operations.NOT(operations.LT(state, { produces: ["a"] as const })),
    and: operations.AND,
    or: operations.OR,
  };

  const result = rebrandTop(map[inst.op](s2), "value");

  return storeValueIfNeeded(result, inst.dest);
}

/**
 * Generate a unary operation
 */
export function generateUnary<S extends Stack>(
  state: GenState<S>,
  inst: Ir.UnaryOpInstruction,
): GenState<readonly ["value", ...S]> {
  const s1 = rebrandTop(loadValue(state, inst.operand), "a");

  const map: {
    [O in Ir.UnaryOp]: <S extends Stack>(
      state: GenState<readonly ["a", ...S]>,
    ) => GenState<readonly [StackBrand, ...S]>;
  } = {
    not: operations.NOT,
    neg: (state) => {
      const s0 = rebrandTop(state, "b");
      const s1 = emitPush(s0, 0n, { brand: "a" });
      return operations.SUB(s1);
    },
  };

  const result = rebrandTop(map[inst.op](s1), "value");

  return storeValueIfNeeded(result, inst.dest);
}

/**
 * Generate a const instruction
 */
export function generateConst<S extends Stack>(
  state: GenState<S>,
  inst: Ir.ConstInstruction,
): GenState<readonly ["value", ...S]> {
  const s = emitPush(state, BigInt(inst.value));
  return storeValueIfNeeded(s, inst.dest);
}

/**
 * Generate local load
 */
export function generateLoadLocal<S extends Stack>(
  state: GenState<S>,
  inst: Ir.LoadLocalInstruction,
): GenState<readonly ["value", ...S]> {
  const allocation = state.memory.allocations[inst.local];
  if (allocation === undefined) {
    throw new EvmError(
      EvmErrorCode.MEMORY_ALLOCATION_FAILED,
      `Local ${inst.local} not allocated in memory`,
    );
  }

  const s1 = emitPush(state, BigInt(allocation.offset), { brand: "offset" });
  const s2 = operations.MLOAD(s1);

  return storeValueIfNeeded(s2, inst.dest);
}

/**
 * Generate local store
 */
export function generateStoreLocal<S extends Stack>(
  state: GenState<readonly [...S]>,
  inst: Ir.StoreLocalInstruction,
): GenState<readonly [...S]> {
  const allocation = state.memory.allocations[inst.local];
  if (allocation === undefined) {
    throw new EvmError(
      EvmErrorCode.MEMORY_ALLOCATION_FAILED,
      `Local ${inst.local} not allocated in memory`,
    );
  }

  const s1 = loadValue(state, inst.value);
  const s2 = emitPush(s1, BigInt(allocation.offset), { brand: "offset" });
  return operations.MSTORE(s2);
}
/**
 * Generate storage load
 */
export function generateLoadStorage<S extends Stack>(
  state: GenState<S>,
  inst: Ir.LoadStorageInstruction,
): GenState<readonly ["value", ...S]> {
  const s1 = rebrandTop(loadValue(state, inst.slot), "key");
  const result = operations.SLOAD(s1);
  return storeValueIfNeeded(rebrandTop(result, "value"), inst.dest);
}

/**
 * Generate storage store
 */
export function generateStoreStorage<S extends Stack>(
  state: GenState<readonly [...S]>,
  inst: Ir.StoreStorageInstruction,
): GenState<readonly [...S]> {
  const s1 = rebrandTop(loadValue(state, inst.value), "value");
  const s2 = rebrandTop(loadValue(s1, inst.slot), "key");
  const s3 = operations.SSTORE(s2);
  return s3;
}

/**
 * Generate environment operations
 */
export function generateEnvOp<S extends Stack>(
  state: GenState<readonly [...S]>,
  inst: Ir.EnvInstruction,
): GenState<readonly ["value", ...S]> {
  const map: {
    [O in Ir.EnvOp]: <S extends Stack>(
      state: GenState<readonly [...S]>,
    ) => GenState<readonly [StackBrand, ...S]>;
  } = {
    msg_sender: operations.CALLER,
    msg_value: operations.CALLVALUE,
    msg_data: operations.PUSH0, // Simplified for now
    block_timestamp: operations.TIMESTAMP,
    block_number: operations.NUMBER,
  };

  const result = rebrandTop(map[inst.op](state), "value");
  return storeValueIfNeeded(result, inst.dest);
}

/**
 * Generate a terminator (control flow)
 */
export function generateTerminator<S extends Stack>(
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
          const s2 = emitPush(s1, BigInt(offset), { brand: "offset" });
          const s4 = operations.MSTORE(s2);
          // Now return from that memory location
          const s5 = emitPush(s4, 32n, { brand: "size" });
          const s6 = emitPush(s5, BigInt(offset), { brand: "offset" });
          return operations.RETURN(s6);
        } else {
          // Value already in memory, return from there
          offset = allocation.offset;
          const s1 = emitPush(state, 32n, { brand: "size" });
          const s2 = emitPush(s1, BigInt(offset), { brand: "offset" });
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

/**
 * Generate code for a single IR instruction
 */
export function generateInstruction<S extends Stack>(
  state: GenState<S>,
  inst: Ir.IrInstruction,
) {
  switch (inst.kind) {
    case "const":
      return generateConst(state, inst);
    case "binary":
      return generateBinary(state, inst);
    case "unary":
      return generateUnary(state, inst);
    case "load_storage":
      return generateLoadStorage(state, inst);
    case "store_storage":
      return generateStoreStorage(state, inst);
    case "load_local":
      return generateLoadLocal(state, inst);
    case "store_local":
      return generateStoreLocal(state, inst);
    case "env":
      return generateEnvOp(state, inst as Ir.EnvInstruction);
    case "hash":
      return generateHashOp(state, inst);
    case "length":
      return generateLength(state, inst);
    case "compute_slot":
      return generateComputeSlot(state, inst);
    case "compute_array_slot":
      return generateComputeArraySlot(state, inst);
    default: {
      // Add warning for unsupported instructions
      const warning = new EvmError(
        EvmErrorCode.UNSUPPORTED_INSTRUCTION,
        inst.kind,
        inst.loc,
        Severity.Warning,
      );
      return {
        ...state,
        warnings: [...state.warnings, warning],
      };
    }
  }
}

function generateLength<S extends Stack>(
  state: GenState<readonly [...S]>,
  inst: Ir.LengthInstruction,
) {
  // Length instruction - behavior depends on the type
  const objectType = inst.object.type;

  if (objectType.kind === "array") {
    if (objectType.size !== undefined) {
      // Fixed-size array - emit the constant
      const s1 = emitPush(state, BigInt(objectType.size));
      return storeValueIfNeeded(s1, inst.dest);
    } else {
      // Dynamic array - length is stored at the array's base slot
      const s1 = rebrandTop(loadValue(state, inst.object), "key");
      const s2 = operations.SLOAD(s1);
      return storeValueIfNeeded(s2, inst.dest);
    }
  }

  if (objectType.kind === "bytes") {
    if (objectType.size !== undefined) {
      // Fixed-size bytes - emit the constant
      const s1 = emitPush(state, BigInt(objectType.size));
      return storeValueIfNeeded(s1, inst.dest);
    }
  }

  throw new EvmError(
    EvmErrorCode.UNSUPPORTED_INSTRUCTION,
    `length operation not supported for type: ${objectType.kind}`,
  );
}

function generateHashOp<S extends Stack>(
  state: GenState<readonly [...S]>,
  inst: Ir.HashInstruction,
) {
  const s1 = loadValue(state, inst.value);

  // Store value at memory offset 0
  const s2 = emitPush(s1, 0n, { brand: "offset" });
  const s3 = operations.MSTORE(s2);

  // Hash 32 bytes starting at offset 0
  const s4 = emitPush(s3, 32n, { brand: "size" });
  const s5 = emitPush(s4, 0n, { brand: "offset" });
  const s6 = operations.KECCAK256(s5);

  const s7 = rebrandTop(s6, "value");

  return storeValueIfNeeded(s7, inst.dest);
}

function generateComputeSlot<S extends Stack>(
  state: GenState<readonly [...S]>,
  inst: Ir.ComputeSlotInstruction,
) {
  // store key then baseSlot in memory as 32 bytes each
  const s1 = loadValue(state, inst.key);

  const s2 = emitPush(s1, 0n, { brand: "offset" });
  const s3 = operations.MSTORE(s2);

  const s4 = loadValue(s3, inst.baseSlot);
  const s5 = emitPush(s4, 32n, { brand: "offset" });
  const s6 = operations.MSTORE(s5);

  const s7 = emitPush(s6, 64n, { brand: "size" });
  const s8 = emitPush(s7, 0n, { brand: "offset" });
  const s9 = operations.KECCAK256(s8, { produces: ["value"] as const });

  return storeValueIfNeeded(s9, inst.dest);
}

function generateComputeArraySlot<S extends Stack>(
  state: GenState<readonly [...S]>,
  inst: Ir.ComputeArraySlotInstruction,
) {
  // For arrays: keccak256(baseSlot)
  const s1 = loadValue(state, inst.baseSlot);
  // s1 has baseSlot on tracked stack

  // Store baseSlot at memory offset 0
  const s2 = emitPush(s1, 0n, { brand: "offset" });
  const s3 = operations.MSTORE(s2);

  // Hash 32 bytes starting at offset 0
  const s4 = emitPush(s3, 32n, { brand: "size" });
  const s5 = emitPush(s4, 0n, { brand: "offset" });
  const s6 = operations.KECCAK256(s5);

  const s7 = rebrandTop(s6, "value");

  return storeValueIfNeeded(s7, inst.dest);
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

function generateBlock(
  state: GenState<Stack>,
  block: Ir.BasicBlock,
  predecessor?: string,
  isLastBlock: boolean = false,
  isFirstBlock: boolean = false,
): GenState<Stack> {
  const currentOffset = calculateSize(state.instructions);
  const s1 = {
    ...state,
    blockOffsets: {
      ...state.blockOffsets,
      [block.id]: currentOffset,
    },
  };

  // JUMPDEST at block start (except for the entry block with no predecessors)
  const skipJumpdest = isFirstBlock && block.predecessors.size === 0;
  const s2 = skipJumpdest ? s1 : operations.JUMPDEST(s1);

  // Generate phi nodes if coming from a predecessor
  const s3 =
    predecessor && block.phis.length > 0
      ? generatePhis(s2, block.phis, predecessor)
      : s2;

  // Generate instructions
  const s4 = block.instructions.reduce(
    (acc, inst) => generateInstruction(acc, inst),
    s3,
  );

  // Generate terminator
  return generateTerminator(s4, block.terminator, isLastBlock);
}

/**
 * Patch jump targets in serialized instructions
 */
function patchJumps<S extends Stack>(
  state: GenState<readonly [...S]>,
): GenState<readonly [...S]> {
  // Apply patches
  const patchedInstructions = [...state.instructions];
  for (const patch of state.patches) {
    const targetOffset = state.blockOffsets[patch.target];
    if (targetOffset === undefined) {
      throw new Error(`Unknown jump target: ${patch.target}`);
    }

    // Replace the placeholder PUSH2 with the actual address
    const push2Inst = patchedInstructions[patch.index];
    if (push2Inst.mnemonic !== "PUSH2") {
      throw new Error(
        `Expected PUSH2 at patch location, got ${push2Inst.mnemonic}`,
      );
    }

    // Update the immediates with the actual target offset
    patchedInstructions[patch.index] = {
      ...push2Inst,
      immediates: [(targetOffset >> 8) & 0xff, targetOffset & 0xff],
    };
  }

  return {
    ...state,
    // clear these now
    patches: [],
    instructions: patchedInstructions,
  };
}
