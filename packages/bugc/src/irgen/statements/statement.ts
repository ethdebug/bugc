import type * as Ast from "#ast";
import { Severity } from "#result";
import { Error as IrgenError } from "../errors.js";
import { type IrGen, addError } from "../irgen.js";

import { makeBuildBlock } from "./block.js";

import { buildExpressionStatement } from "./express.js";
import { buildDeclarationStatement } from "./declare.js";
import { makeBuildControlFlowStatement } from "./control-flow.js";
import { buildAssignmentStatement } from "./assign.js";

const buildControlFlowStatement = makeBuildControlFlowStatement(buildStatement);

export const buildBlock = makeBuildBlock(buildStatement);

/**
 * Build a statement
 */
export function* buildStatement(stmt: Ast.Statement): IrGen<void> {
  switch (stmt.type) {
    case "DeclarationStatement":
      return yield* buildDeclarationStatement(stmt);
    case "AssignmentStatement":
      return yield* buildAssignmentStatement(stmt);
    case "ControlFlowStatement":
      return yield* buildControlFlowStatement(
        stmt as Ast.Statement.ControlFlow,
      );
    case "ExpressionStatement":
      return yield* buildExpressionStatement(stmt as Ast.Statement.Express);
    default:
      return yield* addError(
        new IrgenError(
          // @ts-expect-error switch statement is exhaustive
          `Unsupported statement type: ${stmt.type}`,
          // @ts-expect-error switch statement is exhaustive
          stmt.loc ?? undefined,
          Severity.Error,
        ),
      );
  }
}
