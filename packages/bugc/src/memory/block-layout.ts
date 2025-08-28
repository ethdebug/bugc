/**
 * Block Layout Planning for EVM Code Generation
 *
 * Determines the order of basic blocks and their bytecode offsets
 * for jump target resolution.
 */

import type { IrFunction, IrModule } from "../ir";
import { Result } from "../result";
import { MemoryError, MemoryErrorCode } from "./errors";

export interface FunctionBlockLayout {
  /** Order in which to generate blocks */
  order: string[];
  /** Bytecode offset for each block (filled during generation) */
  offsets: Map<string, number>;
}

/**
 * Module-level block layout information
 */
export interface BlockInfo {
  create?: FunctionBlockLayout;
  main: FunctionBlockLayout;
  functions: {
    [functionName: string]: FunctionBlockLayout;
  };
}

/**
 * Perform depth-first traversal to order blocks
 */
function dfsOrder(
  func: IrFunction,
  blockId: string,
  visited: Set<string> = new Set(),
): string[] {
  if (visited.has(blockId)) return [];
  visited.add(blockId);

  const block = func.blocks.get(blockId);
  if (!block) return [];

  const term = block.terminator;

  if (term.kind === "jump") {
    return [blockId, ...dfsOrder(func, term.target, visited)];
  } else if (term.kind === "branch") {
    // Visit true branch first (arbitrary but consistent)
    const trueBranch = dfsOrder(func, term.trueTarget, visited);
    const falseBranch = dfsOrder(func, term.falseTarget, visited);
    return [blockId, ...trueBranch, ...falseBranch];
  } else {
    return [blockId];
  }
}

/**
 * Layout blocks for a function
 *
 * Uses depth-first order to keep related blocks together,
 * minimizing jump distances.
 */
function layoutFunctionBlocks(
  func: IrFunction,
): Result<FunctionBlockLayout, MemoryError> {
  try {
    const visited = new Set<string>();
    const order = dfsOrder(func, func.entry, visited);

    // Add any unreachable blocks at the end
    const unreachable = Array.from(func.blocks.keys()).filter(
      (id) => !visited.has(id),
    );

    return Result.ok({
      order: [...order, ...unreachable],
      offsets: new Map(),
    });
  } catch (error) {
    return Result.err(
      new MemoryError(
        MemoryErrorCode.INVALID_LAYOUT,
        error instanceof Error ? error.message : "Unknown error",
      ),
    );
  }
}

/**
 * Analyze block layout for entire module
 */
export function analyzeModuleBlockLayout(
  module: IrModule,
): Result<BlockInfo, MemoryError> {
  const result: BlockInfo = {
    main: {} as FunctionBlockLayout,
    functions: {},
  };

  // Process constructor if present
  if (module.create) {
    const createLayout = layoutFunctionBlocks(module.create);
    if (!createLayout.success) {
      return createLayout;
    }
    result.create = createLayout.value;
  }

  // Process main function
  const mainLayout = layoutFunctionBlocks(module.main);
  if (!mainLayout.success) {
    return mainLayout;
  }
  result.main = mainLayout.value;

  // Process user-defined functions
  for (const [name, func] of module.functions) {
    const funcLayout = layoutFunctionBlocks(func);
    if (!funcLayout.success) {
      return funcLayout;
    }
    result.functions[name] = funcLayout.value;
  }

  return Result.ok(result);
}

// Legacy exports for compatibility
export type BlockLayout = FunctionBlockLayout;
export const layoutBlocks = (func: IrFunction): FunctionBlockLayout => {
  const result = layoutFunctionBlocks(func);
  if (!result.success) {
    throw new Error(
      Object.values(result.messages)[0]?.[0]?.message || "Layout failed",
    );
  }
  return result.value;
};
