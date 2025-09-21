import type * as Ast from "#ast";
import * as Ir from "#ir";

import { assertExhausted } from "#irgen/errors";
import { type Process } from "../process.js";
import type { Context } from "./context.js";

import { buildIdentifier } from "./identifier.js";
import { buildLiteral } from "./literal.js";
import { makeBuildOperator } from "./operator.js";
import { makeBuildAccess } from "./access.js";
import { makeBuildCall } from "./call.js";
import { makeBuildCast } from "./cast.js";
import { buildSpecial } from "./special.js";
import { buildArray } from "./array.js";

const buildOperator = makeBuildOperator(buildExpression);
const buildAccess = makeBuildAccess(buildExpression);
const buildCall = makeBuildCall(buildExpression);
const buildCast = makeBuildCast(buildExpression);

/**
 * Build an expression and return the resulting IR value
 */
export function* buildExpression(
  expr: Ast.Expression,
  context: Context,
): Process<Ir.Value> {
  switch (expr.type) {
    case "IdentifierExpression":
      return yield* buildIdentifier(expr as Ast.Expression.Identifier);
    case "LiteralExpression":
      return yield* buildLiteral(expr as Ast.Expression.Literal);
    case "OperatorExpression":
      return yield* buildOperator(expr as Ast.Expression.Operator, context);
    case "AccessExpression":
      return yield* buildAccess(expr as Ast.Expression.Access, context);
    case "CallExpression":
      return yield* buildCall(expr as Ast.Expression.Call, context);
    case "CastExpression":
      return yield* buildCast(expr as Ast.Expression.Cast, context);
    case "SpecialExpression":
      return yield* buildSpecial(expr as Ast.Expression.Special);
    case "ArrayExpression":
      return yield* buildArray(expr as Ast.Expression.Array, context);
    case "StructExpression":
      // TODO: Implement struct expression generation
      throw new Error(
        "Struct expressions not yet implemented in IR generation",
      );
    default:
      assertExhausted(expr);
  }
}
