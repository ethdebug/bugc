import type { Program } from "#ast";
import type { Pass } from "#compiler";
import { Result } from "#result";

import type { ParseError } from "./errors.js";
import { parse } from "./parser.js";

/**
 * Parsing pass - converts source code to AST
 */
export const pass: Pass<{
  needs: {
    source: string;
    sourcePath?: string;
  };
  adds: {
    ast: Program;
  };
  error: ParseError;
}> = {
  async run({ source }) {
    const result = parse(source);
    return Result.map(result, (ast) => ({ ast }));
  },
};
