import type { Program } from "../ast";
import type { TypeMap } from "../types";
import type { IrModule, IrError } from "../ir";
import { Result } from "../result";
import type { Pass } from "../compiler/pass";

import { IrGenerator } from "./generator";

/**
 * IR generation pass - converts typed AST to intermediate representation
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
    const generator = new IrGenerator();
    const result = generator.build(ast, types);

    return Result.map(result, (ir: IrModule) => ({ ir }));
  },
};
