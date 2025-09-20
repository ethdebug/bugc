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
  const value = yield* buildExpression(stmt.value);
  yield* buildLValue(stmt.target, value);
}

/**
 * Handle lvalue assignment
 */
function* buildLValue(node: Ast.Expression, value: Ir.Value): Process<void> {
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
        kind: "store_storage",
        slot: Ir.Value.constant(BigInt(storageSlot.slot), {
          kind: "uint",
          bits: 256,
        }),
        value,
        loc: node.loc ?? undefined,
      } as Ir.Instruction);
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

          yield* Process.Instructions.emit({
            kind: "store_field",
            object,
            field: fieldName,
            fieldIndex,
            value,
            loc: node.loc ?? undefined,
          } as Ir.Instruction);
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

        yield* Process.Instructions.emit({
          kind: "store_index",
          array: object,
          index,
          value,
          loc: node.loc ?? undefined,
        } as Ir.Instruction);
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
        yield* Process.Instructions.emit({
          kind: "store_index",
          array: object,
          index,
          value,
          loc: node.loc ?? undefined,
        } as Ir.Instruction);
        return;
      }
    }
  }

  yield* Process.Errors.report(
    new IrgenError("Invalid lvalue", node.loc || undefined, Severity.Error),
  );
}
