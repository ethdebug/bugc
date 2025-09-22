import type * as Ast from "#ast";
import * as Ir from "#ir";
import { Severity } from "#result";

import { Error as IrgenError } from "#irgen/errors";
import { fromBugType } from "#irgen/type";

import { Process } from "../process.js";

/**
 * Build a literal expression
 */
export function* buildLiteral(expr: Ast.Expression.Literal): Process<Ir.Value> {
  // Get the type from the context
  const nodeType = yield* Process.Types.nodeType(expr);

  if (!nodeType) {
    yield* Process.Errors.report(
      new IrgenError(
        `Cannot determine type for literal: ${expr.value}`,
        expr.loc ?? undefined,
        Severity.Error,
      ),
    );
    // Return a default value to allow compilation to continue
    return Ir.Value.constant(0n, Ir.Type.Scalar.uint256);
  }

  const type = fromBugType(nodeType);

  // Parse the literal value based on its kind
  let value: bigint | string | boolean;
  switch (expr.kind) {
    case "number":
      value = BigInt(expr.value);
      break;
    case "hex": {
      // For hex literals, check if they fit in a BigInt (up to 32 bytes / 256 bits)
      const hexValue = expr.value.startsWith("0x")
        ? expr.value.slice(2)
        : expr.value;

      // If the hex value is longer than 64 characters (32 bytes),
      // store it as a string with 0x prefix
      if (hexValue.length > 64) {
        value = expr.value.startsWith("0x") ? expr.value : `0x${expr.value}`;
      } else {
        value = BigInt(expr.value);
      }
      break;
    }
    case "address":
    case "string":
      value = expr.value;
      break;
    case "boolean":
      value = expr.value === "true";
      break;
    default:
      yield* Process.Errors.report(
        new IrgenError(
          `Unknown literal kind: ${expr.kind}`,
          expr.loc || undefined,
          Severity.Error,
        ),
      );
      return Ir.Value.constant(0n, Ir.Type.Scalar.uint256);
  }

  const tempId = yield* Process.Variables.newTemp();

  yield* Process.Instructions.emit({
    kind: "const",
    dest: tempId,
    value,
    type,
    loc: expr.loc || undefined,
  } as Ir.Instruction.Const);

  return Ir.Value.temp(tempId, type);
}
