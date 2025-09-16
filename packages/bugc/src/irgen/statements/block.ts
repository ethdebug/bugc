import * as Ast from "#ast";
import { type IrGen, pushScope, popScope } from "../irgen.js";

/**
 * Build a block of statements
 */
export const makeBuildBlock = (
  buildStatement: (stmt: Ast.Statement) => IrGen<void>,
) =>
  function* buildBlock(block: Ast.Block): IrGen<void> {
    yield* pushScope();

    for (const item of block.items) {
      if ("type" in item && Ast.isStatement(item)) {
        yield* buildStatement(item);
      }
    }

    yield* popScope();
  };
