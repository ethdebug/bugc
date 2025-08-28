import type { IrModule } from "../ir";
import { PhiInsertion } from "./phi-inserter";
import { Result } from "../result";
import type { Pass } from "../compiler/pass";

/**
 * Phi insertion pass - adds SSA phi nodes at control flow join points
 */
export const pass: Pass<{
  needs: {
    ir: IrModule;
  };
  adds: {
    ir: IrModule;
  };
  error: never;
}> = {
  async run({ ir }) {
    const phiInsertion = new PhiInsertion();
    return Result.ok({
      ir: phiInsertion.insertPhiNodes(ir),
    });
  },
};
