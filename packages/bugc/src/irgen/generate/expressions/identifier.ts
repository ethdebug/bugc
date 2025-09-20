import type * as Ast from "#ast";
import * as Ir from "#ir";
import { Severity } from "#result";

import { Error as IrgenError, ErrorMessages } from "#irgen/errors";

import { Process } from "../process.js";

/**
 * Build an identifier expression
 */
export function* buildIdentifier(
  expr: Ast.Expression.Identifier,
): Process<Ir.Value> {
  const ssaVar = yield* Process.Variables.lookup(expr.name);

  if (ssaVar) {
    // Return the current SSA temp for this variable
    return Ir.Value.temp(ssaVar.currentTempId, ssaVar.type);
  }

  // Check if it's a storage variable
  const storageSlot = yield* Process.Storage.findSlot(expr.name);

  if (storageSlot) {
    // Build storage load directly
    const tempId = yield* Process.Variables.newTemp();
    yield* Process.Instructions.emit({
      kind: "load_storage",
      slot: Ir.Value.constant(BigInt(storageSlot.slot), {
        kind: "uint",
        bits: 256,
      }),
      type: storageSlot.type,
      dest: tempId,
      loc: expr.loc ?? undefined,
    } as Ir.Instruction.LoadStorage);
    return Ir.Value.temp(tempId, storageSlot.type);
  }

  // Unknown identifier - add error and return default value
  yield* Process.Errors.report(
    new IrgenError(
      ErrorMessages.UNKNOWN_IDENTIFIER(expr.name),
      expr.loc ?? undefined,
      Severity.Error,
    ),
  );

  return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
}
