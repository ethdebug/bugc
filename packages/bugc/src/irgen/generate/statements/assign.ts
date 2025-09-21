import * as Ast from "#ast";
import * as Ir from "#ir";
import { Type } from "#types";
import { Error as IrgenError } from "#irgen/errors";
import { Severity } from "#result";
import { buildExpression } from "../expressions/index.js";
import { Process } from "../process.js";

import {
  makeFindStorageAccessChain,
  emitStorageChainAssignment,
} from "../storage.js";

const findStorageAccessChain = makeFindStorageAccessChain(buildExpression);

/**
 * Build an assignment statement
 */
export function* buildAssignmentStatement(
  stmt: Ast.Statement.Assign,
): Process<void> {
  yield* buildLValue(stmt.target, stmt.value);
}

/**
 * Handle lvalue assignment
 * @param target The target expression to assign to
 * @param valueExpr The value expression being assigned
 */
function* buildLValue(
  target: Ast.Expression,
  valueExpr: Ast.Expression,
): Process<void> {
  // Special case: array expression assignment to storage array
  if (
    valueExpr.type === "ArrayExpression" &&
    target.type === "IdentifierExpression"
  ) {
    const targetName = (target as Ast.Expression.Identifier).name;
    const storageSlot = yield* Process.Storage.findSlot(targetName);

    if (storageSlot && storageSlot.type.kind === "array") {
      yield* expandArrayToStorage(
        valueExpr as Ast.Expression.Array,
        storageSlot,
        target.loc ?? undefined,
      );
      return;
    }
  }

  // Regular assignment - evaluate the value expression
  const value = yield* buildExpression(valueExpr);
  yield* assignToTarget(target, value);
}

/**
 * Expand an array expression to individual storage writes
 */
function* expandArrayToStorage(
  arrayExpr: Ast.Expression.Array,
  storageSlot: { slot: number; type: Ir.Type },
  loc: Ast.SourceLocation | undefined,
): Process<void> {
  // First, store the array length at the base slot
  const lengthValue = Ir.Value.constant(BigInt(arrayExpr.elements.length), {
    kind: "uint",
    bits: 256,
  });
  yield* Process.Instructions.emit({
    kind: "write",
    location: "storage",
    slot: Ir.Value.constant(BigInt(storageSlot.slot), {
      kind: "uint",
      bits: 256,
    }),
    offset: Ir.Value.constant(0n, { kind: "uint", bits: 256 }),
    length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
    value: lengthValue,
    loc,
  } as Ir.Instruction.Write);

  // Then write each element
  for (let i = 0; i < arrayExpr.elements.length; i++) {
    // Generate the value for this element
    const elementValue = yield* buildExpression(arrayExpr.elements[i]);

    // Generate the index value
    const indexValue = Ir.Value.constant(BigInt(i), {
      kind: "uint",
      bits: 256,
    });

    // Compute slot for array[i]
    const slotTemp = yield* Process.Variables.newTemp();
    yield* Process.Instructions.emit(
      Ir.Instruction.ComputeSlot.array(
        Ir.Value.constant(BigInt(storageSlot.slot), {
          kind: "uint",
          bits: 256,
        }),
        indexValue,
        slotTemp,
        loc,
      ),
    );

    // Write to storage
    yield* Process.Instructions.emit({
      kind: "write",
      location: "storage",
      slot: Ir.Value.temp(slotTemp, { kind: "uint", bits: 256 }),
      offset: Ir.Value.constant(0n, { kind: "uint", bits: 256 }),
      length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
      value: elementValue,
      loc,
    } as Ir.Instruction.Write);
  }
}

/**
 * Assign a value to a target expression (identifier or access expression)
 */
function* assignToTarget(node: Ast.Expression, value: Ir.Value): Process<void> {
  if (node.type === "IdentifierExpression") {
    const name = (node as Ast.Expression.Identifier).name;

    // Check if it's a variable
    const ssaVar = yield* Process.Variables.lookup(name);
    if (ssaVar) {
      // Create new SSA version for assignment
      const newSsaVar = yield* Process.Variables.assignSsa(name, ssaVar.type);

      // Generate assignment to new SSA temp
      if (value.kind === "temp" && value.id === newSsaVar.currentTempId) {
        // Already assigned to correct temp, no need to copy
        return;
      }

      // Copy the value to the new SSA temp
      yield* Process.Instructions.emit({
        kind: "binary",
        op: "add",
        left: value,
        right: Ir.Value.constant(0n, ssaVar.type),
        dest: newSsaVar.currentTempId,
        loc: node.loc ?? undefined,
      } as Ir.Instruction);
      return;
    }

    // Check if it's storage
    const storageSlot = yield* Process.Storage.findSlot(name);
    if (storageSlot) {
      yield* Process.Instructions.emit({
        kind: "write",
        location: "storage",
        slot: Ir.Value.constant(BigInt(storageSlot.slot), {
          kind: "uint",
          bits: 256,
        }),
        offset: Ir.Value.constant(0n, { kind: "uint", bits: 256 }),
        length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }), // 32 bytes for uint256
        value,
        loc: node.loc ?? undefined,
      } as Ir.Instruction.Write);
      return;
    }

    yield* Process.Errors.report(
      new IrgenError(
        `Unknown identifier: ${name}`,
        node.loc || undefined,
        Severity.Error,
      ),
    );
    return;
  }

  if (node.type === "AccessExpression") {
    const accessNode = node as Ast.Expression.Access;

    if (accessNode.kind === "member") {
      // First check if this is a storage chain assignment
      const chain = yield* findStorageAccessChain(node);
      if (chain) {
        yield* emitStorageChainAssignment(chain, value, node.loc ?? undefined);
        return;
      }

      // Otherwise, handle regular struct field assignment
      const object = yield* buildExpression(accessNode.object);
      const objectType = yield* Process.Types.nodeType(accessNode.object);

      if (objectType && Type.isStruct(objectType)) {
        const fieldName = accessNode.property as string;
        const fieldType = objectType.fields.get(fieldName);
        if (fieldType) {
          // Find field index
          let fieldIndex = 0;
          for (const [name] of objectType.fields) {
            if (name === fieldName) break;
            fieldIndex++;
          }

          // First compute the offset for the field
          const offsetTemp = yield* Process.Variables.newTemp();
          // Calculate field offset - assuming 32 bytes per field for now
          const fieldOffset = fieldIndex * 32;
          yield* Process.Instructions.emit({
            kind: "compute_offset",
            location: "memory",
            base: object,
            field: fieldName,
            fieldOffset,
            dest: offsetTemp,
            loc: node.loc ?? undefined,
          } as Ir.Instruction.ComputeOffset);

          // Then write to that offset
          yield* Process.Instructions.emit({
            kind: "write",
            location: "memory",
            offset: Ir.Value.temp(offsetTemp, { kind: "uint", bits: 256 }),
            length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
            value,
            loc: node.loc ?? undefined,
          } as Ir.Instruction.Write);
          return;
        }
      }
    } else if (Ast.Expression.Access.isIndex(accessNode)) {
      // Array/mapping/bytes assignment
      // First check if we're assigning to bytes
      const objectType = yield* Process.Types.nodeType(accessNode.object);
      if (
        objectType &&
        Type.isElementary(objectType) &&
        Type.Elementary.isBytes(objectType)
      ) {
        // Handle bytes indexing directly
        const object = yield* buildExpression(accessNode.object);
        const index = yield* buildExpression(accessNode.index);

        // Compute offset for the byte at the index
        const offsetTemp = yield* Process.Variables.newTemp();
        yield* Process.Instructions.emit({
          kind: "compute_offset",
          location: "memory",
          base: object,
          index,
          stride: 1, // bytes are 1 byte each
          dest: offsetTemp,
          loc: node.loc ?? undefined,
        } as Ir.Instruction.ComputeOffset);

        // Write the byte at that offset
        yield* Process.Instructions.emit({
          kind: "write",
          location: "memory",
          offset: Ir.Value.temp(offsetTemp, { kind: "uint", bits: 256 }),
          length: Ir.Value.constant(1n, { kind: "uint", bits: 256 }),
          value,
          loc: node.loc ?? undefined,
        } as Ir.Instruction.Write);
        return;
      }

      // For non-bytes types, try to find a complete storage access chain
      const chain = yield* findStorageAccessChain(node);
      if (chain) {
        yield* emitStorageChainAssignment(chain, value, node.loc ?? undefined);
        return;
      }

      // If no storage chain, handle regular array/mapping access
      const object = yield* buildExpression(accessNode.object);
      const index = yield* buildExpression(accessNode.index);

      if (objectType && Type.isArray(objectType)) {
        // Compute offset for array element
        const offsetTemp = yield* Process.Variables.newTemp();
        yield* Process.Instructions.emit({
          kind: "compute_offset",
          location: "memory",
          base: object,
          index,
          stride: 32, // array elements are 32 bytes each
          dest: offsetTemp,
          loc: node.loc ?? undefined,
        } as Ir.Instruction.ComputeOffset);

        // Write the element at that offset
        yield* Process.Instructions.emit({
          kind: "write",
          location: "memory",
          offset: Ir.Value.temp(offsetTemp, { kind: "uint", bits: 256 }),
          length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
          value,
          loc: node.loc ?? undefined,
        } as Ir.Instruction.Write);
        return;
      }
    }
  }

  yield* Process.Errors.report(
    new IrgenError("Invalid lvalue", node.loc || undefined, Severity.Error),
  );
}
