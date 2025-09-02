/**
 * EVM Code Generation Module
 *
 * A self-contained EVM backend that transforms IR to EVM bytecode with
 * careful stack and memory management. Includes analysis, generation,
 * and operation utilities.
 */

// Main generation entry point
export { generateModule } from "./generator";
export { pass } from "./pass";

// Error handling
export { EvmError, EvmErrorCode } from "./errors";

// Analysis exports (internal modules that were moved into evmgen)
export type { LivenessInfo, FunctionLivenessInfo } from "./analysis/liveness";
export type { MemoryInfo, FunctionMemoryLayout } from "./analysis/memory";
export type { BlockInfo, FunctionBlockLayout } from "./analysis/layout";
export { analyzeModuleLiveness } from "./analysis/liveness";
export { analyzeModuleMemory } from "./analysis/memory";
export { analyzeModuleBlockLayout } from "./analysis/layout";

// Generation utilities
export { generateFunction } from "./generation/function";
export { generateBlock } from "./generation/block";
export { generateInstruction } from "./generation/instruction";

// Operations and state management
export { type GenState, operations } from "./operations";
