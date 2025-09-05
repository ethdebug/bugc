import type { IrModule } from "#ir";
import { optimizeIr } from "./simple-optimizer.js";
import { type OptimizationLevel } from "./optimizer.js";
import { Result } from "#result";
import type { Pass } from "#compiler";

/**
 * Optimization pass - optimizes intermediate representation
 */
export const pass: Pass<{
  needs: {
    ir: IrModule;
    optimizer?: {
      level?: OptimizationLevel;
    };
  };
  adds: {
    ir: IrModule;
  };
  error: never;
}> = {
  async run({ ir, optimizer: { level = 0 } = {} }) {
    return Result.ok({
      ir: optimizeIr(ir, level),
    });
  },
};
