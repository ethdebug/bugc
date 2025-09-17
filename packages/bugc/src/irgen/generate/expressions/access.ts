import * as Ast from "#ast";
import * as Ir from "#ir";
import { Severity } from "#result";
import { Type } from "#types";

import { Error as IrgenError, assertExhausted } from "#irgen/errors";

import { Process } from "../process.js";
import { fromBugType } from "#irgen/type";
import {
  type StorageAccessChain,
  makeFindStorageAccessChain,
  emitStorageChainLoad,
} from "../storage.js";

/**
 * Build an access expression (array/member access)
 */
export const makeBuildAccess = (
  buildExpression: (node: Ast.Expression) => Process<Ir.Value>,
) => {
  const findStorageAccessChain = makeFindStorageAccessChain(buildExpression);
  const buildIndexAccess = makeBuildIndexAccess(
    buildExpression,
    findStorageAccessChain,
  );
  const buildMemberAccess = makeBuildMemberAccess(
    buildExpression,
    findStorageAccessChain,
  );
  const buildSliceAccess = makeBuildSliceAccess(buildExpression);

  return function* buildAccess(expr: Ast.Expression.Access): Process<Ir.Value> {
    switch (expr.kind) {
      case "member":
        return yield* buildMemberAccess(expr);

      case "slice":
        return yield* buildSliceAccess(expr);

      case "index":
        return yield* buildIndexAccess(expr);

      default:
        assertExhausted(expr);
    }
  };
};

const makeBuildMemberAccess = (
  buildExpression: (node: Ast.Expression) => Process<Ir.Value>,
  findStorageAccessChain: (
    node: Ast.Expression,
  ) => Process<StorageAccessChain | undefined>,
) =>
  function* buildMemberAccess(
    expr: Ast.Expression.Access.Member,
  ): Process<Ir.Value> {
    // Check if this is a .length property access
    if (expr.property === "length") {
      const objectType = yield* Process.Types.nodeType(expr.object);

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
        const tempId = yield* Process.Variables.newTemp();

        yield* Process.Instructions.emit({
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
      const nodeType = yield* Process.Types.nodeType(expr);
      if (nodeType) {
        const valueType = fromBugType(nodeType);
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
    const objectType = yield* Process.Types.nodeType(expr.object);

    if (objectType && Type.isStruct(objectType)) {
      const fieldType = objectType.fields.get(expr.property);
      if (fieldType) {
        const fieldIndex = Array.from(objectType.fields.keys()).indexOf(
          expr.property,
        );
        const irFieldType = fromBugType(fieldType);
        const tempId = yield* Process.Variables.newTemp();

        yield* Process.Instructions.emit({
          kind: "load_field",
          object,
          field: expr.property,
          fieldIndex,
          type: irFieldType,
          dest: tempId,
          loc: expr.loc ?? undefined,
        } as Ir.Instruction);

        return Ir.Value.temp(tempId, irFieldType);
      }
    }

    throw new IrgenError(
      "Invalid member access expression",
      expr.loc ?? undefined,
      Severity.Error,
    );
  };

const makeBuildSliceAccess = (
  buildExpression: (node: Ast.Expression) => Process<Ir.Value>,
) =>
  function* buildSliceAccess(
    expr: Ast.Expression.Access.Slice,
  ): Process<Ir.Value> {
    // Slice access - start:end
    const objectType = yield* Process.Types.nodeType(expr.object);
    if (
      objectType &&
      Type.isElementary(objectType) &&
      Type.Elementary.isBytes(objectType)
    ) {
      const object = yield* buildExpression(expr.object);
      const start = yield* buildExpression(expr.start);
      const end = yield* buildExpression(expr.end);

      // Slicing bytes returns dynamic bytes
      const resultType: Ir.Type = { kind: "bytes" };
      const tempId = yield* Process.Variables.newTemp();

      yield* Process.Instructions.emit({
        kind: "slice",
        object,
        start,
        end,
        dest: tempId,
        loc: expr.loc ?? undefined,
      } as Ir.Instruction);

      return Ir.Value.temp(tempId, resultType);
    }

    throw new IrgenError(
      "Only bytes types can be sliced",
      expr.loc ?? undefined,
      Severity.Error,
    );
  };

const makeBuildIndexAccess = (
  buildExpression: (node: Ast.Expression) => Process<Ir.Value>,
  findStorageAccessChain: (
    node: Ast.Expression,
  ) => Process<StorageAccessChain | undefined>,
) =>
  function* buildIndexAccess(
    expr: Ast.Expression.Access.Index,
  ): Process<Ir.Value> {
    // Array/mapping/bytes index access
    // First check if we're indexing into bytes (not part of storage chain)
    const nodeType = yield* Process.Types.nodeType(expr);
    const objectType = yield* Process.Types.nodeType(expr.object);
    if (
      objectType &&
      Type.isElementary(objectType) &&
      Type.Elementary.isBytes(objectType)
    ) {
      // Handle bytes indexing directly, not as storage chain
      const object = yield* buildExpression(expr.object);
      const index = yield* buildExpression(expr.index);
      // Bytes indexing returns uint8
      const elementType: Ir.Type = { kind: "uint", bits: 8 };
      const tempId = yield* Process.Variables.newTemp();

      yield* Process.Instructions.emit({
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
    if (chain && nodeType) {
      const valueType = fromBugType(nodeType);
      return yield* emitStorageChainLoad(
        chain,
        valueType,
        expr.loc ?? undefined,
      );
    }

    // If no storage chain, handle regular array/mapping access
    const object = yield* buildExpression(expr.object);
    const index = yield* buildExpression(expr.index);

    if (objectType && Type.isArray(objectType)) {
      const elementType = fromBugType(objectType.element);
      const tempId = yield* Process.Variables.newTemp();

      yield* Process.Instructions.emit({
        kind: "load_index",
        array: object,
        index,
        elementType,
        dest: tempId,
        loc: expr.loc ?? undefined,
      } as Ir.Instruction);

      return Ir.Value.temp(tempId, elementType);
    }

    if (
      objectType &&
      Type.isMapping(objectType) &&
      Ast.Expression.isIdentifier(expr.object)
    ) {
      // Simple mapping access
      const storageVar = yield* Process.Storage.findSlot(expr.object.name);
      if (storageVar) {
        const valueType = fromBugType(objectType.value);
        const tempId = yield* Process.Variables.newTemp();

        yield* Process.Instructions.emit({
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

    throw new IrgenError(
      "Invalid index access expression",
      expr.loc ?? undefined,
      Severity.Error,
    );
  };
