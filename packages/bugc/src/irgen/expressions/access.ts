import type * as Ast from "#ast";
import * as Ir from "#ir";
import { Severity } from "#result";
import { Type } from "#types";
import { Error as IrgenError } from "../errors.js";
import { type IrGen, gen } from "../irgen.js";
import { mapTypeToIrType } from "../type.js";
import {
  makeFindStorageAccessChain,
  findStorageVariable,
  emitStorageChainLoad,
} from "../storage.js";

/**
 * Build an access expression (array/member access)
 */
export const makeBuildAccess = (
  buildExpression: (node: Ast.Expression) => IrGen<Ir.Value>,
) => {
  const findStorageAccessChain = makeFindStorageAccessChain(buildExpression);

  return function* buildAccess(expr: Ast.Expression.Access): IrGen<Ir.Value> {
    if (expr.kind === "member") {
      const property = expr.property as string;

      // Check if this is a .length property access
      if (property === "length") {
        const state = yield* gen.peek();
        const objectType = state.types.get(expr.object.id);

        // Verify that the object type supports .length (arrays, bytes, string)
        if (
          objectType &&
          (Type.isArray(objectType) ||
            (Type.isElementary(objectType) &&
              (Type.Elementary.isBytes(objectType) ||
                Type.Elementary.isString(objectType))))
        ) {
          const object = yield* buildExpression(expr.object);
          const resultType: Ir.Type = { kind: "uint", bits: 256 };
          const tempId = yield* gen.genTemp();

          yield* gen.emit({
            kind: "length",
            object,
            dest: tempId,
            loc: expr.loc ?? undefined,
          } as Ir.Instruction);

          return Ir.Value.temp(tempId, resultType);
        }
      }

      // First check if this is accessing a storage chain (e.g., accounts[user].balance)
      const chain = yield* findStorageAccessChain(expr);
      if (chain) {
        const state = yield* gen.peek();
        const nodeType = state.types.get(expr.id);
        if (nodeType) {
          const valueType = mapTypeToIrType(nodeType);
          return yield* emitStorageChainLoad(
            chain,
            valueType,
            expr.loc ?? undefined,
          );
        }
      }

      // Reading through local variables is allowed, no diagnostic needed

      // Otherwise, handle regular struct field access
      const object = yield* buildExpression(expr.object);
      const state = yield* gen.peek();
      const objectType = state.types.get(expr.object.id);

      if (objectType && Type.isStruct(objectType)) {
        const fieldType = objectType.fields.get(property);
        if (fieldType) {
          const fieldIndex = Array.from(objectType.fields.keys()).indexOf(
            property,
          );
          const irFieldType = mapTypeToIrType(fieldType);
          const tempId = yield* gen.genTemp();

          yield* gen.emit({
            kind: "load_field",
            object,
            field: property,
            fieldIndex,
            type: irFieldType,
            dest: tempId,
            loc: expr.loc ?? undefined,
          } as Ir.Instruction);

          return Ir.Value.temp(tempId, irFieldType);
        }
      }
    } else if (expr.kind === "slice") {
      // Slice access - start:end
      const state = yield* gen.peek();
      const objectType = state.types.get(expr.object.id);
      if (
        objectType &&
        Type.isElementary(objectType) &&
        Type.Elementary.isBytes(objectType)
      ) {
        const object = yield* buildExpression(expr.object);
        const start = yield* buildExpression(expr.property as Ast.Expression);
        const end = yield* buildExpression(expr.end!);

        // Slicing bytes returns dynamic bytes
        const resultType: Ir.Type = { kind: "bytes" };
        const tempId = yield* gen.genTemp();

        yield* gen.emit({
          kind: "slice",
          object,
          start,
          end,
          dest: tempId,
          loc: expr.loc ?? undefined,
        } as Ir.Instruction);

        return Ir.Value.temp(tempId, resultType);
      }

      yield* gen.addError(
        new IrgenError(
          "Only bytes types can be sliced",
          expr.loc ?? undefined,
          Severity.Error,
        ),
      );
      return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
    } else {
      // Array/mapping/bytes index access
      // First check if we're indexing into bytes (not part of storage chain)
      const state = yield* gen.peek();
      const objectType = state.types.get(expr.object.id);
      if (
        objectType &&
        Type.isElementary(objectType) &&
        Type.Elementary.isBytes(objectType)
      ) {
        // Handle bytes indexing directly, not as storage chain
        const object = yield* buildExpression(expr.object);
        const index = yield* buildExpression(expr.property as Ast.Expression);
        // Bytes indexing returns uint8
        const elementType: Ir.Type = { kind: "uint", bits: 8 };
        const tempId = yield* gen.genTemp();

        yield* gen.emit({
          kind: "load_index",
          array: object,
          index,
          elementType,
          dest: tempId,
          loc: expr.loc ?? undefined,
        } as Ir.Instruction);

        return Ir.Value.temp(tempId, elementType);
      }

      // For non-bytes types, try to find a complete storage access chain
      const chain = yield* findStorageAccessChain(expr);
      if (chain) {
        const nodeType = state.types.get(expr.id);
        if (nodeType) {
          const valueType = mapTypeToIrType(nodeType);
          return yield* emitStorageChainLoad(
            chain,
            valueType,
            expr.loc ?? undefined,
          );
        }
      }

      // If no storage chain, handle regular array/mapping access
      const object = yield* buildExpression(expr.object);
      const index = yield* buildExpression(expr.property as Ast.Expression);

      if (objectType && Type.isArray(objectType)) {
        const elementType = mapTypeToIrType(objectType.element);
        const tempId = yield* gen.genTemp();

        yield* gen.emit({
          kind: "load_index",
          array: object,
          index,
          elementType,
          dest: tempId,
          loc: expr.loc ?? undefined,
        } as Ir.Instruction);

        return Ir.Value.temp(tempId, elementType);
      } else if (objectType && Type.isMapping(objectType)) {
        // Simple mapping access
        const storageVar = yield* findStorageVariable(expr.object);
        if (storageVar) {
          const valueType = mapTypeToIrType(objectType.value);
          const tempId = yield* gen.genTemp();

          yield* gen.emit({
            kind: "load_mapping",
            slot: storageVar.slot,
            key: index,
            valueType,
            dest: tempId,
            loc: expr.loc ?? undefined,
          } as Ir.Instruction);

          return Ir.Value.temp(tempId, valueType);
        }
      }
    }

    yield* gen.addError(
      new IrgenError(
        "Invalid access expression",
        expr.loc ?? undefined,
        Severity.Error,
      ),
    );
    return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
  };
};
