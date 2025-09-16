import * as Ast from "#ast";
import * as Ir from "#ir";
import { Severity } from "#result";

import { Error as IrgenError } from "../errors.js";
import { type IrGen, addError, emit, peek, newTemp } from "../irgen.js";
import { mapTypeToIrType } from "../type.js";

/**
 * Build an operator expression (unary or binary)
 */
export const makeBuildOperator = (
  buildExpression: (node: Ast.Expression) => IrGen<Ir.Value>,
) => {
  const buildUnaryOperator = makeBuildUnaryOperator(buildExpression);
  const buildBinaryOperator = makeBuildBinaryOperator(buildExpression);

  return function* buildOperator(
    expr: Ast.Expression.Operator,
  ): IrGen<Ir.Value> {
    // Get the type from the context
    const state = yield* peek();
    const nodeType = state.types.get(expr.id);

    if (!nodeType) {
      yield* addError(
        new IrgenError(
          `Cannot determine type for operator expression: ${expr.operator}`,
          expr.loc ?? undefined,
          Severity.Error,
        ),
      );
      return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
    }

    switch (expr.operands.length) {
      case 1:
        return yield* buildUnaryOperator(expr);
      case 2:
        return yield* buildBinaryOperator(expr);
      default: {
        yield* addError(
          new IrgenError(
            `Invalid operator arity: ${expr.operands.length}`,
            expr.loc || undefined,
            Severity.Error,
          ),
        );
        return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
      }
    }
  };
};
/**
 * Build a unary operator expression
 */
const makeBuildUnaryOperator = (
  buildExpression: (expr: Ast.Expression) => IrGen<Ir.Value>,
) =>
  function* buildUnaryOperator(expr: Ast.Expression.Operator): IrGen<Ir.Value> {
    // Get the result type from the context
    const state = yield* peek();
    const nodeType = state.types.get(expr.id);

    if (!nodeType) {
      yield* addError(
        new IrgenError(
          `Cannot determine type for unary operator: ${expr.operator}`,
          expr.loc ?? undefined,
          Severity.Error,
        ),
      );
      return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
    }

    const resultType = mapTypeToIrType(nodeType);

    // Evaluate operand
    const operandVal = yield* buildExpression(expr.operands[0]);

    // Generate temp for result
    const tempId = yield* newTemp();

    // Map operator (matching generator.ts logic)
    const op = expr.operator === "!" ? "not" : "neg";

    // Emit unary operation
    yield* emit({
      kind: "unary",
      op,
      operand: operandVal,
      dest: tempId,
      loc: expr.loc ?? undefined,
    } as Ir.Instruction.UnaryOp);

    return Ir.Value.temp(tempId, resultType);
  };

/**
 * Build a binary operator expression
 */
const makeBuildBinaryOperator = (
  buildExpression: (node: Ast.Expression) => IrGen<Ir.Value>,
) =>
  function* buildBinaryOperator(
    expr: Ast.Expression.Operator,
  ): IrGen<Ir.Value> {
    // Get the result type from the context
    const state = yield* peek();
    const nodeType = state.types.get(expr.id);

    if (!nodeType) {
      yield* addError(
        new IrgenError(
          `Cannot determine type for binary operator: ${expr.operator}`,
          expr.loc ?? undefined,
          Severity.Error,
        ),
      );
      return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
    }

    const resultType = mapTypeToIrType(nodeType);

    // Evaluate operands
    const leftVal = yield* buildExpression(expr.operands[0]);
    const rightVal = yield* buildExpression(expr.operands[1]);

    // Generate temp for result
    const tempId = yield* newTemp();

    // Emit binary operation
    yield* emit({
      kind: "binary",
      op: mapBinaryOp(expr.operator),
      left: leftVal,
      right: rightVal,
      dest: tempId,
      loc: expr.loc ?? undefined,
    } as Ir.Instruction.BinaryOp);

    return Ir.Value.temp(tempId, resultType);
  };

function mapBinaryOp(op: string): Ir.Instruction.BinaryOp["op"] {
  const opMap: Record<string, Ir.Instruction.BinaryOp["op"]> = {
    "+": "add",
    "-": "sub",
    "*": "mul",
    "/": "div",
    "%": "mod",
    "==": "eq",
    "!=": "ne",
    "<": "lt",
    "<=": "le",
    ">": "gt",
    ">=": "ge",
    "&&": "and",
    "||": "or",
  };
  return opMap[op] || "add";
}
