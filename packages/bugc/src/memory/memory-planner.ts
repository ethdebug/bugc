/**
 * Memory Planning for EVM Code Generation
 *
 * Allocates memory slots for values that need to persist across
 * stack operations or block boundaries.
 */

import type { IrFunction, IrInstruction, Value, IrModule } from "../ir";
import type { FunctionLivenessInfo } from "../liveness";
import { Result } from "../result";
import { MemoryError, MemoryErrorCode } from "./errors";

export interface FunctionMemoryLayout {
  /** Memory offset for each value that needs allocation */
  allocations: Record<string, number>;
  /** Next available memory slot */
  freePointer: number;
}

/**
 * Module-level memory information
 */
export interface MemoryInfo {
  create?: FunctionMemoryLayout;
  main: FunctionMemoryLayout;
  functions: {
    [functionName: string]: FunctionMemoryLayout;
  };
}

/**
 * Simulate stack effects of an instruction
 */
function simulateInstruction(stack: string[], inst: IrInstruction): string[] {
  const newStack = [...stack];

  // Pop consumed values based on instruction type
  switch (inst.kind) {
    case "binary":
    case "store_storage":
    case "store_mapping":
    case "compute_slot":
    case "hash":
      newStack.pop(); // Two operands
      newStack.pop();
      break;
    case "compute_array_slot":
    case "compute_field_offset":
      newStack.pop(); // One operand (baseSlot)
      break;
    case "unary":
    case "store_local":
    case "cast":
    case "length":
      newStack.pop(); // One operand
      break;
    case "store_field":
    case "load_index":
      newStack.pop(); // Two operands
      newStack.pop();
      break;
    case "store_index":
    case "slice":
      newStack.pop(); // Three operands
      newStack.pop();
      newStack.pop();
      break;
    case "call":
      // Pop arguments
      for (let i = 0; i < inst.arguments.length; i++) {
        newStack.pop();
      }
      break;
    // These don't pop anything
    case "const":
    case "env":
    case "load_storage":
    case "load_mapping":
    case "load_local":
    case "load_field":
      break;
  }

  // Push produced value
  if ("dest" in inst && inst.dest) {
    newStack.push(inst.dest);
  } else if (inst.kind === "store_local") {
    // store_local defines the local
    newStack.push(inst.local);
  }

  return newStack;
}

/**
 * Get the ID from a Value
 */
function valueId(val: Value): string {
  if (val.kind === "const") {
    return `$const_${val.value}`;
  } else if (val.kind === "temp") {
    return val.id;
  } else {
    return val.name;
  }
}

/**
 * Collect all values used by an instruction
 */
function getUsedValues(inst: IrInstruction): Set<string> {
  const used = new Set<string>();

  // Helper to add a value if it's not a constant
  const addValue = (val: Value | undefined): void => {
    if (val && val.kind !== "const") {
      used.add(valueId(val));
    }
  };

  // Check instruction type and extract used values
  switch (inst.kind) {
    case "binary":
      addValue(inst.left);
      addValue(inst.right);
      break;
    case "unary":
      addValue(inst.operand);
      break;
    case "load_storage":
      addValue(inst.slot);
      break;
    case "store_storage":
      addValue(inst.slot);
      addValue(inst.value);
      break;
    case "load_mapping":
      addValue(inst.key);
      break;
    case "store_mapping":
      addValue(inst.key);
      addValue(inst.value);
      break;
    case "compute_slot":
      addValue(inst.baseSlot);
      addValue(inst.key);
      break;
    case "compute_array_slot":
      addValue(inst.baseSlot);
      break;
    case "compute_field_offset":
      addValue(inst.baseSlot);
      break;
    case "load_local":
      used.add(inst.local);
      break;
    case "store_local":
      addValue(inst.value);
      break;
    case "load_field":
      addValue(inst.object);
      break;
    case "store_field":
      addValue(inst.object);
      addValue(inst.value);
      break;
    case "load_index":
      addValue(inst.array);
      addValue(inst.index);
      break;
    case "store_index":
      addValue(inst.array);
      addValue(inst.index);
      addValue(inst.value);
      break;
    case "slice":
      addValue(inst.object);
      addValue(inst.start);
      addValue(inst.end);
      break;
    case "cast":
      addValue(inst.value);
      break;
    case "length":
      addValue(inst.object);
      break;
    case "hash":
      addValue(inst.value);
      break;
    case "call":
      for (const arg of inst.arguments) {
        addValue(arg);
      }
      break;
  }

  return used;
}

/**
 * Find position of value in stack (0 = top)
 */
function findStackPosition(stack: string[], value: string): number {
  const index = stack.lastIndexOf(value);
  return index === -1 ? -1 : stack.length - 1 - index;
}

/**
 * Identify values that need memory allocation
 */
function identifyMemoryValues(
  func: IrFunction,
  liveness: FunctionLivenessInfo,
): Set<string> {
  const needsMemory = new Set<string>();

  // All cross-block values need memory
  for (const value of liveness.crossBlockValues) {
    needsMemory.add(value);
  }

  // All phi destinations need memory
  for (const [_, block] of func.blocks) {
    for (const phi of block.phis) {
      needsMemory.add(phi.dest);
    }
  }

  // Simulate stack to find values that might overflow
  for (const blockId of func.blocks.keys()) {
    const block = func.blocks.get(blockId)!;
    const liveAtEntry = liveness.liveIn.get(blockId) || new Set();

    // Start with live-in values on stack
    let stack: string[] = Array.from(liveAtEntry);

    for (const inst of block.instructions) {
      // Check if any used values are too deep in stack
      for (const usedId of getUsedValues(inst)) {
        const position = findStackPosition(stack, usedId);
        if (position > 16 || position === -1) {
          needsMemory.add(usedId);
        }
      }

      // Values used in array slot computation need memory
      // because KECCAK256 will consume the base slot
      if (inst.kind === "compute_array_slot") {
        // The baseSlot might need to be preserved
        const baseSlotId = valueId(inst.baseSlot);
        if (liveAtEntry.has(baseSlotId)) {
          needsMemory.add(baseSlotId);
        }
      }

      // Simulate the instruction's effect on stack
      stack = simulateInstruction(stack, inst);

      // If stack is getting too deep, spill bottom values
      if (stack.length > 14) {
        // Conservative threshold
        // Mark bottom values as needing memory
        for (let i = 0; i < stack.length - 14; i++) {
          needsMemory.add(stack[i]);
        }
      }
    }

    // Check terminator usage
    const term = block.terminator;
    if (term.kind === "branch" && term.condition.kind !== "const") {
      const condId = valueId(term.condition);
      const position = findStackPosition(stack, condId);
      if (position > 16 || position === -1) {
        needsMemory.add(condId);
      }
    }
  }

  return needsMemory;
}

/**
 * Plan memory layout for a function
 */
export function planFunctionMemory(
  func: IrFunction,
  liveness: FunctionLivenessInfo,
): Result<FunctionMemoryLayout, MemoryError> {
  try {
    const allocations: Record<string, number> = {};
    let freePointer = 0x80; // Start after Solidity's free memory pointer

    const needsMemory = identifyMemoryValues(func, liveness);

    // Also allocate memory for all locals (they always need memory)
    for (const local of func.locals || []) {
      needsMemory.add(local.id);
    }

    // Check if we have too many values for memory
    if (needsMemory.size > 1000) {
      return Result.err(
        new MemoryError(
          MemoryErrorCode.ALLOCATION_FAILED,
          `Too many values need memory allocation: ${needsMemory.size}`,
        ),
      );
    }

    // Allocate 32-byte slots for each value
    for (const value of needsMemory) {
      allocations[value] = freePointer;
      freePointer += 32;
    }

    return Result.ok({
      allocations,
      freePointer,
    });
  } catch (error) {
    return Result.err(
      new MemoryError(
        MemoryErrorCode.ALLOCATION_FAILED,
        error instanceof Error ? error.message : "Unknown error",
      ),
    );
  }
}

/**
 * Analyze memory requirements for entire module
 */
export function analyzeModuleMemory(
  module: IrModule,
  liveness: {
    create?: FunctionLivenessInfo;
    main?: FunctionLivenessInfo;
    functions: {
      [functionName: string]: FunctionLivenessInfo;
    };
  },
): Result<MemoryInfo, MemoryError> {
  const result: MemoryInfo = {
    main: {} as FunctionMemoryLayout,
    functions: {},
  };

  // Process constructor if present
  if (module.create && liveness.create) {
    const createMemory = planFunctionMemory(module.create, liveness.create);
    if (!createMemory.success) {
      return createMemory;
    }
    result.create = createMemory.value;
  }

  // Process main function
  if (!liveness.main) {
    return Result.err(
      new MemoryError(
        MemoryErrorCode.INVALID_LAYOUT,
        "Missing liveness info for main function",
      ),
    );
  }
  const mainMemory = planFunctionMemory(module.main, liveness.main);
  if (!mainMemory.success) {
    return mainMemory;
  }
  result.main = mainMemory.value;

  // Process user-defined functions
  for (const [name, func] of module.functions) {
    const funcLiveness = liveness.functions[name];
    if (!funcLiveness) {
      return Result.err(
        new MemoryError(
          MemoryErrorCode.INVALID_LAYOUT,
          `Missing liveness info for function ${name}`,
        ),
      );
    }
    const funcMemory = planFunctionMemory(func, funcLiveness);
    if (!funcMemory.success) {
      return funcMemory;
    }
    result.functions[name] = funcMemory.value;
  }

  return Result.ok(result);
}
