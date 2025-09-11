import type { Program } from "#ast";
import type { Types } from "#types";
import type * as Ir from "#ir";
import { Result } from "#result";
import type { Pass } from "#compiler";

import { Error } from "./errors.js";
import { IrBuilder } from "./generator.js";
import { PhiInserter } from "./phi-inserter.js";

/**
 * IR generation pass - converts typed AST to intermediate representation
 * and inserts phi nodes for proper SSA form
 */
const pass: Pass<{
  needs: {
    ast: Program;
    types: Types;
  };
  adds: {
    ir: Ir.Module;
  };
  error: Error;
}> = {
  async run({ ast, types }) {
    const generator = new IrBuilder();
    const result = generator.build(ast, types);

    // Insert phi nodes after generating the IR
    return Result.map(result, (ir: Ir.Module) => {
      const phiInserter = new PhiInserter();
      const irWithPhis = phiInserter.insertPhiNodes(ir);
      return { ir: irWithPhis };
    });
  },
};

export default pass;
