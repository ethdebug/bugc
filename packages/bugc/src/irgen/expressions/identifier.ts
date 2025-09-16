import type * as Ast from "#ast";
import * as Ir from "#ir";
import { Error as IrgenError, ErrorMessages } from "../errors.js";
import { Severity } from "#result";
import {
  type IrGen,
  addError,
  emit,
  lookupVariable,
  peek,
  newTemp,
} from "../irgen.js";
/**
 * Build an identifier expression
 */
export function* buildIdentifier(
  expr: Ast.Expression.Identifier,
): IrGen<Ir.Value> {
  const local = yield* lookupVariable(expr.name);

  if (local) {
    // Load the local variable
    const tempId = yield* newTemp();

    yield* emit({
      kind: "load_local",
      local: local.id,
      dest: tempId,
      loc: expr.loc ?? undefined,
    } as Ir.Instruction.LoadLocal);

    return Ir.Value.temp(tempId, local.type);
  }

  // Check if it's a storage variable
  const state = yield* peek();
  const storageSlot = state.module.storage.slots.find(
    ({ name }) => name === expr.name,
  );

  if (storageSlot) {
    // Build storage load directly
    const tempId = yield* newTemp();
    yield* emit({
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
  yield* addError(
    new IrgenError(
      ErrorMessages.UNKNOWN_IDENTIFIER(expr.name),
      expr.loc ?? undefined,
      Severity.Error,
    ),
  );

  return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
}
