import type * as Ast from "#ast";
import * as Ir from "#ir";
import { Severity } from "#result";
import { Type } from "#types";

import { Error as IrgenError, ErrorMessages } from "./errors.js";
import { type IrGen, gen } from "./irgen.js";

export interface StorageAccessChain {
  slot: Ir.Module.StorageSlot;
  accesses: Array<{
    kind: "index" | "member";
    key?: Ir.Value; // For index access
    fieldName?: string; // For member access
    fieldIndex?: number; // For member access
  }>;
}

/**
 * Find a storage access chain starting from an expression (matching generator.ts)
 */
export const makeFindStorageAccessChain = (
  buildExpression: (node: Ast.Expression) => IrGen<Ir.Value>,
) =>
  function* findStorageAccessChain(
    expr: Ast.Expression,
  ): IrGen<StorageAccessChain | undefined> {
    const accesses: StorageAccessChain["accesses"] = [];
    let current = expr;

    // Walk up the access chain from right to left
    while (current.type === "AccessExpression") {
      const accessNode = current as Ast.Expression.Access;

      if (accessNode.kind === "index") {
        // For index access, we need to evaluate the key expression
        const key = yield* buildExpression(
          accessNode.property as Ast.Expression,
        );
        accesses.unshift({ kind: "index", key });
      } else {
        // For member access on structs
        const fieldName = accessNode.property as string;
        accesses.unshift({ kind: "member", fieldName });
      }

      current = accessNode.object;
    }

    // At the end, we should have an identifier that references storage
    if (current.type === "IdentifierExpression") {
      const name = (current as Ast.Expression.Identifier).name;
      const state = yield* gen.peek();
      const slot = state.module.storage.slots.find((s) => s.name === name);
      if (slot) {
        return { slot, accesses };
      }

      // Check if it's a local variable (which means we're trying to access
      // storage through an intermediate variable - not supported)
      const local = yield* gen.lookupVariable(name);

      if (local && accesses.length > 0) {
        // Get the type to provide better error message
        const localType = state.types.get(current.id);
        const typeDesc = localType
          ? (localType as Type & { name?: string; kind?: string }).name ||
            (localType as Type & { name?: string; kind?: string }).kind ||
            "complex"
          : "unknown";

        yield* gen.addError(
          new IrgenError(
            ErrorMessages.STORAGE_MODIFICATION_ERROR(name, typeDesc),
            expr.loc ?? undefined,
            Severity.Error,
          ),
        );
      }
    } else if (current.type === "CallExpression") {
      // Provide specific error for function calls
      yield* gen.addError(
        new IrgenError(
          ErrorMessages.UNSUPPORTED_STORAGE_PATTERN("function return values"),
          expr.loc || undefined,
          Severity.Error,
        ),
      );
    } else if (accesses.length > 0) {
      // Other unsupported base expressions when we have an access chain
      yield* gen.addError(
        new IrgenError(
          `Storage access chain must start with a storage variable identifier. ` +
            `Found ${current.type} at the base of the access chain.`,
          current.loc ?? undefined,
          Severity.Error,
        ),
      );
    }

    return undefined;
  };

/**
 * Find a storage variable from an expression
 */
export function* findStorageVariable(
  expr: Ast.Expression,
): IrGen<Ir.Module.StorageSlot | undefined> {
  if (expr.type === "IdentifierExpression") {
    const name = (expr as Ast.Expression.Identifier).name;
    const state = yield* gen.peek();
    return state.module.storage.slots.find((s) => s.name === name);
  }
  return undefined;
}

/**
 * Emit a storage chain load (matching generator.ts pattern)
 */
export function* emitStorageChainLoad(
  chain: StorageAccessChain,
  valueType: Ir.Type,
  loc: Ast.SourceLocation | undefined,
): IrGen<Ir.Value> {
  let currentSlot = Ir.Value.constant(BigInt(chain.slot.slot), {
    kind: "uint",
    bits: 256,
  });
  let currentType = chain.slot.type;

  // Process each access in the chain
  for (const access of chain.accesses) {
    if (access.kind === "index" && access.key) {
      // For mapping/array access
      const tempId = yield* gen.genTemp();
      yield* gen.emit({
        kind: "compute_slot",
        baseSlot: currentSlot,
        key: access.key,
        dest: tempId,
        loc,
      } as Ir.Instruction);

      currentSlot = Ir.Value.temp(tempId, { kind: "uint", bits: 256 });

      // Update type based on mapping/array element type
      if (currentType.kind === "mapping") {
        currentType = currentType.value || { kind: "uint", bits: 256 };
      } else if (currentType.kind === "array") {
        currentType = currentType.element || { kind: "uint", bits: 256 };
      }
    } else if (access.kind === "member" && access.fieldName) {
      // For struct field access
      if (currentType.kind === "struct") {
        const fieldIndex =
          currentType.fields.findIndex(
            ({ name }) => name === access.fieldName,
          ) ?? 0;

        const tempId = yield* gen.genTemp();
        yield* gen.emit({
          kind: "compute_field_offset",
          baseSlot: currentSlot,
          fieldIndex,
          dest: tempId,
          loc,
        } as Ir.Instruction);

        currentSlot = Ir.Value.temp(tempId, { kind: "uint", bits: 256 });
        currentType = currentType.fields[fieldIndex]?.type || {
          kind: "uint",
          bits: 256,
        };
      }
    }
  }

  // Generate the final load_storage instruction
  const loadTempId = yield* gen.genTemp();
  yield* gen.emit({
    kind: "load_storage",
    slot: currentSlot,
    type: valueType,
    dest: loadTempId,
    loc,
  } as Ir.Instruction.LoadStorage);

  return Ir.Value.temp(loadTempId, valueType);
}
