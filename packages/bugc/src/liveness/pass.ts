/**
 * Liveness Analysis Pass
 *
 * Computes liveness information for IR values across the program.
 */

import type { IrModule } from "../ir";
import type { Pass } from "../compiler/pass";
import { Result } from "../result";
import { analyzeModuleLiveness } from "./liveness";
import type { LivenessInfo } from "./liveness";

/**
 * Liveness analysis pass - computes liveness information for IR values
 */
export const pass: Pass<{
  needs: {
    ir: IrModule;
  };
  adds: {
    liveness: LivenessInfo;
  };
  error: never;
}> = {
  async run({ ir }) {
    const liveness = analyzeModuleLiveness(ir);

    return Result.ok({
      liveness
    });
  },
};
