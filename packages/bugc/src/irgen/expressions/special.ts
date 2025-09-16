import type * as Ast from "#ast";
import * as Ir from "#ir";
import { Severity } from "#result";
import { Error as IrgenError } from "../errors.js";
import { type IrGen, addError, emit, peek, newTemp } from "../irgen.js";
import { mapTypeToIrType } from "../type.js";

/**
 * Build a special expression (msg.sender, block.number, etc.)
 */
export function* buildSpecial(expr: Ast.Expression.Special): IrGen<Ir.Value> {
  // Get the type from the type checker
  const state = yield* peek();
  const nodeType = state.types.get(expr.id);

  if (!nodeType) {
    yield* addError(
      new IrgenError(
        `Cannot determine type for special expression: ${expr.kind}`,
        expr.loc ?? undefined,
        Severity.Error,
      ),
    );
    // Return a default value to allow compilation to continue
    return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
  }

  const resultType = mapTypeToIrType(nodeType);
  const temp = yield* newTemp();

  let op: Ir.Instruction.Env["op"];
  switch (expr.kind) {
    case "msg.sender":
      op = "msg_sender";
      break;
    case "msg.value":
      op = "msg_value";
      break;
    case "msg.data":
      op = "msg_data";
      break;
    case "block.timestamp":
      op = "block_timestamp";
      break;
    case "block.number":
      op = "block_number";
      break;
    default:
      yield* addError(
        new IrgenError(
          `Unknown special expression: ${expr.kind}`,
          expr.loc || undefined,
          Severity.Error,
        ),
      );
      return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
  }

  yield* emit({
    kind: "env",
    op,
    dest: temp,
    loc: expr.loc ?? undefined,
  } as Ir.Instruction.Env);

  return Ir.Value.temp(temp, resultType);
}
