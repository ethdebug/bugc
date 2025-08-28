import type { IrModule } from "../ir";
import type { Pass } from "../compiler/pass";
import { Result } from "../result";
import type { LivenessInfo } from "../liveness";
import { analyzeModuleMemory, type MemoryInfo } from "./memory-planner";
import { analyzeModuleBlockLayout, type BlockInfo } from "./block-layout";
import type { MemoryError } from "./errors";

/**
 * Memory planning pass - allocates memory for IR values and plans block layouts
 */
export const pass: Pass<{
  needs: {
    ir: IrModule;
    liveness: LivenessInfo;
  };
  adds: {
    memory: MemoryInfo;
    blocks: BlockInfo;
  };
  error: MemoryError;
}> = {
  async run({ ir, liveness }) {
    // Analyze memory requirements
    const memoryResult = analyzeModuleMemory(ir, liveness);
    if (!memoryResult.success) {
      return memoryResult;
    }

    // Analyze block layout
    const blockResult = analyzeModuleBlockLayout(ir);
    if (!blockResult.success) {
      return blockResult;
    }

    return Result.ok({
      memory: memoryResult.value,
      blocks: blockResult.value,
    });
  },
};
