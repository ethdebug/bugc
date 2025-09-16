import type * as Ast from "#ast";
import * as Ir from "#ir";
import { Severity } from "#result";
import { Type } from "#types";
import { Error as IrgenError } from "../errors.js";
import { type IrGen, gen } from "../irgen.js";
import { mapTypeToIrType } from "../type.js";

/**
 * Build a call expression
 */
export const makeBuildCall = (
  buildExpression: (node: Ast.Expression) => IrGen<Ir.Value>,
) =>
  function* buildCall(expr: Ast.Expression.Call): IrGen<Ir.Value> {
    // Check if this is a built-in function call
    if (
      expr.callee.type === "IdentifierExpression" &&
      (expr.callee as Ast.Expression.Identifier).name === "keccak256"
    ) {
      // keccak256 built-in function
      if (expr.arguments.length !== 1) {
        yield* gen.addError(
          new IrgenError(
            "keccak256 expects exactly 1 argument",
            expr.loc ?? undefined,
            Severity.Error,
          ),
        );
        return Ir.Value.constant(0n, { kind: "bytes", size: 32 });
      }

      // Evaluate the argument
      const argValue = yield* buildExpression(expr.arguments[0]);

      // Generate hash instruction
      const resultType: Ir.Type = { kind: "bytes", size: 32 }; // bytes32
      const resultTemp = yield* gen.genTemp();

      yield* gen.emit({
        kind: "hash",
        value: argValue,
        dest: resultTemp,
        loc: expr.loc ?? undefined,
      } as Ir.Instruction);

      return Ir.Value.temp(resultTemp, resultType);
    }

    // Handle user-defined function calls
    if (expr.callee.type === "IdentifierExpression") {
      const functionName = (expr.callee as Ast.Expression.Identifier).name;

      // Get the function type from the type checker
      const state = yield* gen.peek();
      const callType = state.types.get(expr.id);

      if (!callType) {
        yield* gen.addError(
          new IrgenError(
            `Unknown function: ${functionName}`,
            expr.loc ?? undefined,
            Severity.Error,
          ),
        );
        return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
      }

      // Evaluate arguments
      const argValues: Ir.Value[] = [];
      for (const arg of expr.arguments) {
        argValues.push(yield* buildExpression(arg));
      }

      // Generate call instruction
      const irType = mapTypeToIrType(callType);
      let dest: string | undefined;

      // Only create a destination if the function returns a value
      // Check if it's a void function by checking if the type is a failure with "void function" message
      const isVoidFunction =
        Type.isFailure(callType) &&
        (callType as Type.Failure).reason === "void function";

      if (!isVoidFunction) {
        dest = yield* gen.genTemp();
      }

      yield* gen.emit({
        kind: "call",
        function: functionName,
        arguments: argValues,
        dest,
        loc: expr.loc ?? undefined,
      } as Ir.Instruction.Call);

      // Return the result value or a dummy value for void functions
      if (dest) {
        return Ir.Value.temp(dest, irType);
      } else {
        // Void function - return a dummy value
        return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
      }
    }

    // Other forms of function calls not supported
    yield* gen.addError(
      new IrgenError(
        "Complex function call expressions not yet supported",
        expr.loc ?? undefined,
        Severity.Error,
      ),
    );
    return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
  };
