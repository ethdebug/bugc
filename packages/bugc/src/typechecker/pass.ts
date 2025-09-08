import type { Program } from "#ast";
import type { SymbolTable, TypeMap } from "#types";
import type { Pass } from "#compiler";

import type { Error as TypeError } from "./errors.js";
import { checkProgram } from "./checker.js";

/**
 * Type checking pass - validates types and builds symbol table
 */
const pass: Pass<{
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
    return checkProgram(ast);
  },
};

export default pass;
