import type { Program } from "#ast";
import { Result } from "#result";
import type { TypeMap } from "#types";
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
  };
  error: TypeError;
}> = {
  async run({ ast }) {
    return Result.map(checkProgram(ast), (types) => ({ types }));
  },
};

export default pass;
