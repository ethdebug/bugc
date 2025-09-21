import * as Ast from "#ast";
import * as Ir from "#ir";
import { Severity } from "#result";
import { Type } from "#types";

import { Error as IrgenError, assertExhausted } from "#irgen/errors";

import { Process } from "../process.js";
import type { Context } from "./context.js";
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
  buildExpression: (
    node: Ast.Expression,
    context: Context,
  ) => Process<Ir.Value>,
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

  return function* buildAccess(
    expr: Ast.Expression.Access,
    context: Context,
  ): Process<Ir.Value> {
    switch (expr.kind) {
      case "member":
        return yield* buildMemberAccess(expr, context);

      case "slice":
        return yield* buildSliceAccess(expr, context);

      case "index":
        return yield* buildIndexAccess(expr, context);

      default:
        assertExhausted(expr);
    }
  };
};

const makeBuildMemberAccess = (
  buildExpression: (
    node: Ast.Expression,
    context: Context,
  ) => Process<Ir.Value>,
  findStorageAccessChain: (
    node: Ast.Expression,
  ) => Process<StorageAccessChain | undefined>,
) =>
  function* buildMemberAccess(
    expr: Ast.Expression.Access.Member,
    _context: Context,
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
        const object = yield* buildExpression(expr.object, { kind: "rvalue" });
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
    const object = yield* buildExpression(expr.object, { kind: "rvalue" });
    const objectType = yield* Process.Types.nodeType(expr.object);

    if (objectType && Type.isStruct(objectType)) {
      const fieldType = objectType.fields.get(expr.property);
      if (fieldType) {
        const fieldIndex = Array.from(objectType.fields.keys()).indexOf(
          expr.property,
        );
        const irFieldType = fromBugType(fieldType);

        // First compute the offset for the field
        const offsetTemp = yield* Process.Variables.newTemp();
        // Calculate field offset - assuming 32 bytes per field for now
        const fieldOffset = fieldIndex * 32;
        yield* Process.Instructions.emit(
          Ir.Instruction.ComputeOffset.field(
            "memory",
            object,
            expr.property,
            fieldOffset,
            offsetTemp,
            expr.loc ?? undefined,
          ),
        );

        // Then read from that offset
        const tempId = yield* Process.Variables.newTemp();
        yield* Process.Instructions.emit({
          kind: "read",
          location: "memory",
          offset: Ir.Value.temp(offsetTemp, { kind: "uint", bits: 256 }),
          length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
          type: irFieldType,
          dest: tempId,
          loc: expr.loc ?? undefined,
        } as Ir.Instruction.Read);

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
  buildExpression: (
    node: Ast.Expression,
    context: Context,
  ) => Process<Ir.Value>,
) =>
  function* buildSliceAccess(
    expr: Ast.Expression.Access.Slice,
    _context: Context,
  ): Process<Ir.Value> {
    // Slice access - start:end
    const objectType = yield* Process.Types.nodeType(expr.object);
    if (
      objectType &&
      Type.isElementary(objectType) &&
      Type.Elementary.isBytes(objectType)
    ) {
      const object = yield* buildExpression(expr.object, { kind: "rvalue" });
      const start = yield* buildExpression(expr.start, { kind: "rvalue" });
      const end = yield* buildExpression(expr.end, { kind: "rvalue" });

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
  buildExpression: (
    node: Ast.Expression,
    context: Context,
  ) => Process<Ir.Value>,
  findStorageAccessChain: (
    node: Ast.Expression,
  ) => Process<StorageAccessChain | undefined>,
) =>
  function* buildIndexAccess(
    expr: Ast.Expression.Access.Index,
    _context: Context,
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
      const object = yield* buildExpression(expr.object, { kind: "rvalue" });
      const index = yield* buildExpression(expr.index, { kind: "rvalue" });
      // Bytes indexing returns uint8
      const elementType: Ir.Type = { kind: "uint", bits: 8 };

      // Compute offset for the byte at the index
      const offsetTemp = yield* Process.Variables.newTemp();
      yield* Process.Instructions.emit(
        Ir.Instruction.ComputeOffset.array(
          "memory",
          object,
          index,
          1, // bytes are 1 byte each
          offsetTemp,
          expr.loc ?? undefined,
        ),
      );

      // Read the byte at that offset
      const tempId = yield* Process.Variables.newTemp();
      yield* Process.Instructions.emit({
        kind: "read",
        location: "memory",
        offset: Ir.Value.temp(offsetTemp, { kind: "uint", bits: 256 }),
        length: Ir.Value.constant(1n, { kind: "uint", bits: 256 }),
        type: elementType,
        dest: tempId,
        loc: expr.loc ?? undefined,
      } as Ir.Instruction.Read);

      return Ir.Value.temp(tempId, elementType);
    }

    // Check if it's a memory array first (to avoid storage chain check for local arrays)
    if (objectType && Type.isArray(objectType)) {
      // Check if it's a local (memory) array
      if (Ast.Expression.isIdentifier(expr.object)) {
        const varName = expr.object.name;
        const localVar = yield* Process.Variables.lookup(varName);
        if (localVar) {
          // It's a local memory array - handle it directly
          const object = yield* buildExpression(expr.object, {
            kind: "rvalue",
          });
          const index = yield* buildExpression(expr.index, { kind: "rvalue" });
          const elementType = fromBugType(objectType.element);

          // Calculate base + 32 to skip length field
          const elementsBaseTemp = yield* Process.Variables.newTemp();
          yield* Process.Instructions.emit({
            kind: "binary",
            op: "add",
            left: object,
            right: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
            dest: elementsBaseTemp,
            loc: expr.loc ?? undefined,
          } as Ir.Instruction);

          // Compute offset for array element
          const offsetTemp = yield* Process.Variables.newTemp();
          yield* Process.Instructions.emit(
            Ir.Instruction.ComputeOffset.array(
              "memory",
              Ir.Value.temp(elementsBaseTemp, { kind: "uint", bits: 256 }),
              index,
              32, // array elements are 32 bytes each
              offsetTemp,
              expr.loc ?? undefined,
            ),
          );

          // Read the element at that offset
          const tempId = yield* Process.Variables.newTemp();
          yield* Process.Instructions.emit({
            kind: "read",
            location: "memory",
            offset: Ir.Value.temp(offsetTemp, { kind: "uint", bits: 256 }),
            length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
            type: elementType,
            dest: tempId,
            loc: expr.loc ?? undefined,
          } as Ir.Instruction.Read);

          return Ir.Value.temp(tempId, elementType);
        }
      }
    }

    // For non-bytes, non-memory-array types, try to find a complete storage access chain
    const chain = yield* findStorageAccessChain(expr);
    if (chain && nodeType) {
      const valueType = fromBugType(nodeType);
      return yield* emitStorageChainLoad(
        chain,
        valueType,
        expr.loc ?? undefined,
      );
    }

    // If no storage chain, handle remaining cases
    const object = yield* buildExpression(expr.object, { kind: "rvalue" });
    const index = yield* buildExpression(expr.index, { kind: "rvalue" });

    if (objectType && Type.isArray(objectType)) {
      // This would be for complex array access (e.g., returned from function)
      const elementType = fromBugType(objectType.element);

      // Compute offset for array element (no need to add 32 here as the object
      // should already point to the elements section)
      const offsetTemp = yield* Process.Variables.newTemp();
      yield* Process.Instructions.emit(
        Ir.Instruction.ComputeOffset.array(
          "memory",
          object,
          index,
          32, // array elements are 32 bytes each
          offsetTemp,
          expr.loc ?? undefined,
        ),
      );

      // Read the element at that offset
      const tempId = yield* Process.Variables.newTemp();
      yield* Process.Instructions.emit({
        kind: "read",
        location: "memory",
        offset: Ir.Value.temp(offsetTemp, { kind: "uint", bits: 256 }),
        length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
        type: elementType,
        dest: tempId,
        loc: expr.loc ?? undefined,
      } as Ir.Instruction.Read);

      return Ir.Value.temp(tempId, elementType);
    }

    if (
      objectType &&
      Type.isMapping(objectType) &&
      Ast.Expression.isIdentifier(expr.object)
    ) {
      // Simple mapping access - compute slot then read
      const storageVar = yield* Process.Storage.findSlot(expr.object.name);
      if (storageVar) {
        const valueType = fromBugType(objectType.value);

        // First compute the slot for the mapping key
        const slotTempId = yield* Process.Variables.newTemp();
        yield* Process.Instructions.emit({
          kind: "compute_slot",
          slotKind: "mapping",
          base: Ir.Value.constant(BigInt(storageVar.slot), {
            kind: "uint",
            bits: 256,
          }),
          key: index,
          keyType: fromBugType(objectType.key),
          dest: slotTempId,
          loc: expr.loc ?? undefined,
        } as Ir.Instruction.ComputeSlot);

        // Then read from that computed slot
        const tempId = yield* Process.Variables.newTemp();
        yield* Process.Instructions.emit({
          kind: "read",
          location: "storage",
          slot: Ir.Value.temp(slotTempId, { kind: "uint", bits: 256 }),
          offset: Ir.Value.constant(0n, { kind: "uint", bits: 256 }),
          length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
          type: valueType,
          dest: tempId,
          loc: expr.loc ?? undefined,
        } as Ir.Instruction.Read);

        return Ir.Value.temp(tempId, valueType);
      }
    }

    throw new IrgenError(
      "Invalid index access expression",
      expr.loc ?? undefined,
      Severity.Error,
    );
  };
