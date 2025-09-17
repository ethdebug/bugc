import type * as Ast from "#ast";
import { assertExhausted } from "#irgen/errors";

import { Process } from "../process.js";

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
export function* buildStatement(stmt: Ast.Statement): Process<void> {
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
      assertExhausted(stmt);
  }
}
