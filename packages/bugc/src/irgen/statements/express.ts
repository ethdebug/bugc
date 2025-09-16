import type * as Ast from "#ast";
import { type IrGen } from "../irgen.js";
import { buildExpression } from "../expressions/index.js";

/**
 * Build an expression statement
 */
export function* buildExpressionStatement(
  stmt: Ast.Statement.Express,
): IrGen<void> {
  yield* buildExpression(stmt.expression);
}
