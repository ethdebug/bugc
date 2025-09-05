/**
 * EVM Code Generation Module
 *
 * A self-contained EVM backend that transforms IR to EVM bytecode with
 * careful stack and memory management. Includes analysis, generation,
 * and operation utilities.
 */

// Main generation entry point
export { generateModule } from "./generator.js";
export { pass } from "./pass.js";

// Error handling
export { EvmError, EvmErrorCode } from "./errors.js";

// Analysis exports (internal modules that were moved into evmgen)
export type {
  LivenessInfo,
  FunctionLivenessInfo,
} from "./analysis/liveness.js";
export type { MemoryInfo, FunctionMemoryLayout } from "./analysis/memory.js";
export type { BlockInfo, FunctionBlockLayout } from "./analysis/layout.js";
export { analyzeModuleLiveness } from "./analysis/liveness.js";
export { analyzeModuleMemory } from "./analysis/memory.js";
export { analyzeModuleBlockLayout } from "./analysis/layout.js";

// Generation utilities
export { generateFunction } from "./generation/function.js";
export { generateBlock } from "./generation/block.js";
export { generateInstruction } from "./generation/instruction.js";

// Operations and state management
export { type GenState, operations } from "./operations/index.js";
