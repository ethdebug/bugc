import type * as Ast from "#ast";
import * as Ir from "#ir";
import { Severity } from "#result";
import { Error as IrgenError } from "../errors.js";
import { type IrGen, gen } from "../irgen.js";
import { mapTypeToIrType } from "../type.js";

/**
 * Build a cast expression
 */
export const makeBuildCast = (
  buildExpression: (node: Ast.Expression) => IrGen<Ir.Value>,
) =>
  function* buildCast(expr: Ast.Expression.Cast): IrGen<Ir.Value> {
    // Evaluate the expression being cast
    const exprValue = yield* buildExpression(expr.expression);

    // Get the target type from the type checker
    const state = yield* gen.peek();
    const targetType = state.types.get(expr.id);

    if (!targetType) {
      yield* gen.addError(
        new IrgenError(
          "Cannot determine target type for cast expression",
          expr.loc ?? undefined,
          Severity.Error,
        ),
      );
      return exprValue; // Return the original value
    }

    const targetIrType = mapTypeToIrType(targetType);

    // For now, we'll generate a cast instruction that will be handled during bytecode generation
    // In many cases, the cast is a no-op at the IR level (e.g., uint256 to address)
    const resultTemp = yield* gen.genTemp();

    yield* gen.emit({
      kind: "cast",
      value: exprValue,
      targetType: targetIrType,
      dest: resultTemp,
      loc: expr.loc || undefined,
    } as Ir.Instruction.Cast);

    return Ir.Value.temp(resultTemp, targetIrType);
  };
