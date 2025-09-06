import type { Program } from "#ast";
import type { TypeMap } from "#types";
import type { IrModule, IrError } from "#ir";
import { Result } from "#result";
import type { Pass } from "#compiler";

import { IrBuilder } from "./generator.js";
import { PhiInserter } from "./phi-inserter.js";

/**
 * IR generation pass - converts typed AST to intermediate representation
 * and inserts phi nodes for proper SSA form
 */
export const pass: Pass<{
  needs: {
    ast: Program;
    types: TypeMap;
  };
  adds: {
    ir: IrModule;
  };
  error: IrError;
}> = {
  async run({ ast, types }) {
    const generator = new IrBuilder();
    const result = generator.build(ast, types);

    // Insert phi nodes after generating the IR
    return Result.map(result, (ir: IrModule) => {
      const phiInserter = new PhiInserter();
      const irWithPhis = phiInserter.insertPhiNodes(ir);
      return { ir: irWithPhis };
    });
  },
};
