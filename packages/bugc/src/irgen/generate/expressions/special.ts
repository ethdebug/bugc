import type * as Ast from "#ast";
import * as Ir from "#ir";
import { Severity } from "#result";

import { Error as IrgenError } from "#irgen/errors";
import { fromBugType } from "#irgen/type";
import { Process } from "../process.js";
/**
 * Build a special expression (msg.sender, block.number, etc.)
 */
export function* buildSpecial(expr: Ast.Expression.Special): Process<Ir.Value> {
  // Get the type from the type checker
  const nodeType = yield* Process.Types.nodeType(expr);

  if (!nodeType) {
    yield* Process.Errors.report(
      new IrgenError(
        `Cannot determine type for special expression: ${expr.kind}`,
        expr.loc ?? undefined,
        Severity.Error,
      ),
    );
    // Return a default value to allow compilation to continue
    return Ir.Value.constant(0n, Ir.Type.Scalar.uint256);
  }

  const resultType = fromBugType(nodeType);
  const temp = yield* Process.Variables.newTemp();

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
      yield* Process.Errors.report(
        new IrgenError(
          `Unknown special expression: ${expr.kind}`,
          expr.loc || undefined,
          Severity.Error,
        ),
      );
      return Ir.Value.constant(0n, Ir.Type.Scalar.uint256);
  }

  yield* Process.Instructions.emit({
    kind: "env",
    op,
    dest: temp,
    loc: expr.loc ?? undefined,
  } as Ir.Instruction.Env);

  return Ir.Value.temp(temp, resultType);
}
