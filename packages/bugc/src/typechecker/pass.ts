import type { Program } from "../ast";
import type { SymbolTable, TypeMap } from "../types";
import type { TypeError } from "./errors";
import { TypeChecker } from "./checker";
import type { Pass } from "../compiler/pass";

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
