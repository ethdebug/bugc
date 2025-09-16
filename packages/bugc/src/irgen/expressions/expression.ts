import type * as Ast from "#ast";
import * as Ir from "#ir";
import { Severity } from "#result";

import { Error as IrgenError } from "../errors.js";
import { type IrGen, gen } from "../irgen.js";

import { buildIdentifier } from "./identifier.js";
import { buildLiteral } from "./literal.js";
import { makeBuildOperator } from "./operator.js";
import { makeBuildAccess } from "./access.js";
import { makeBuildCall } from "./call.js";
import { makeBuildCast } from "./cast.js";
import { buildSpecial } from "./special.js";

const buildOperator = makeBuildOperator(buildExpression);
const buildAccess = makeBuildAccess(buildExpression);
const buildCall = makeBuildCall(buildExpression);
const buildCast = makeBuildCast(buildExpression);

/**
 * Build an expression and return the resulting IR value
 */
export function* buildExpression(expr: Ast.Expression): IrGen<Ir.Value> {
  switch (expr.type) {
    case "IdentifierExpression":
      return yield* buildIdentifier(expr as Ast.Expression.Identifier);
    case "LiteralExpression":
      return yield* buildLiteral(expr as Ast.Expression.Literal);
    case "OperatorExpression":
      return yield* buildOperator(expr as Ast.Expression.Operator);
    case "AccessExpression":
      return yield* buildAccess(expr as Ast.Expression.Access);
    case "CallExpression":
      return yield* buildCall(expr as Ast.Expression.Call);
    case "CastExpression":
      return yield* buildCast(expr as Ast.Expression.Cast);
    case "SpecialExpression":
      return yield* buildSpecial(expr as Ast.Expression.Special);
    default:
      yield* gen.addError(
        new IrgenError(
          // @ts-expect-error switch statement is exhaustive; expr is never
          `Unsupported expression type: ${expr.type}`,
          // @ts-expect-error switch statement is exhaustive; expr is never
          expr.loc ?? undefined,
          Severity.Error,
        ),
      );
      return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
  }
}
