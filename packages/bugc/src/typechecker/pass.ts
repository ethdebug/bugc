import type { Program } from "#ast";
import type { SymbolTable, TypeMap } from "#types";
import type { Pass } from "#compiler/pass";

import type { TypeError } from "./errors.js";
import { TypeChecker } from "./checker.js";

/**
 * Type checking pass - validates types and builds symbol table
 */
export const pass: Pass<{
  needs: {
    ast: Program;
  };
  adds: {
    types: TypeMap;
    symbolTable: SymbolTable;
  };
  error: TypeError;
}> = {
  async run({ ast }) {
    const checker = new TypeChecker();
    return checker.check(ast);
  },
};
