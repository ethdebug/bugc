/**
 * Memory planning module exports
 */

export {
  analyzeModuleMemory,
  planFunctionMemory,
  type MemoryInfo,
  type FunctionMemoryLayout,
  type FunctionMemoryLayout as MemoryLayout,
} from "./memory-planner";

export {
  analyzeModuleBlockLayout,
  layoutBlocks,
  type BlockInfo,
  type FunctionBlockLayout,
  type FunctionBlockLayout as BlockLayout,
} from "./block-layout";

export { MemoryError, MemoryErrorCode } from "./errors";
export { pass } from "./pass";
