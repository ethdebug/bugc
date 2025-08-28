import type { Program } from "../ast";
import type { ParseError } from "./errors";
import { parse } from "./parser";
import { Result } from "../result";
import type { Pass } from "../compiler/pass";

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
