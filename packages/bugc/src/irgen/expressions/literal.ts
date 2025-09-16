import type * as Ast from "#ast";
import * as Ir from "#ir";
import { Error as IrgenError } from "../errors.js";
import { Severity } from "#result";
import { type IrGen, gen } from "../irgen.js";
import { mapTypeToIrType } from "../type.js";

/**
 * Build a literal expression
 */
export function* buildLiteral(expr: Ast.Expression.Literal): IrGen<Ir.Value> {
  // Get the type from the context
  const state = yield* gen.peek();
  const nodeType = state.types.get(expr.id);

  if (!nodeType) {
    yield* gen.addError(
      new IrgenError(
        `Cannot determine type for literal: ${expr.value}`,
        expr.loc ?? undefined,
        Severity.Error,
      ),
    );
    // Return a default value to allow compilation to continue
    return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
  }

  const type = mapTypeToIrType(nodeType);

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
      yield* gen.addError(
        new IrgenError(
          `Unknown literal kind: ${expr.kind}`,
          expr.loc || undefined,
          Severity.Error,
        ),
      );
      return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
  }

  const tempId = yield* gen.genTemp();

  yield* gen.emit({
    kind: "const",
    dest: tempId,
    value,
    type,
    loc: expr.loc || undefined,
  } as Ir.Instruction.Const);

  return Ir.Value.temp(tempId, type);
}
