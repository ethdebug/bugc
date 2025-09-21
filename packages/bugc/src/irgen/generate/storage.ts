import * as Ast from "#ast";
import * as Ir from "#ir";
import { Severity } from "#result";
import { Type } from "#types";

import { Error as IrgenError, ErrorMessages } from "#irgen/errors";
import { Process } from "./process.js";

export interface StorageAccessChain {
  slot: Ir.Module.StorageSlot;
  accesses: Array<{
    kind: "index" | "member";
    key?: Ir.Value; // For index access
    fieldName?: string; // For member access
    fieldOffset?: number; // Slot offset for member access
  }>;
}

/**
 * Find a storage access chain starting from an expression (matching generator.ts)
 */
export const makeFindStorageAccessChain = (
  buildExpression: (node: Ast.Expression) => Process<Ir.Value>,
) =>
  function* findStorageAccessChain(
    expr: Ast.Expression,
  ): Process<StorageAccessChain | undefined> {
    const accesses: StorageAccessChain["accesses"] = [];
    let current = expr;

    // Walk up the access chain from right to left
    while (Ast.Expression.isAccess(current)) {
      const accessNode = current as Ast.Expression.Access;

      if (accessNode.kind === "index") {
        // For index access, we need to evaluate the key expression
        const key = yield* buildExpression(accessNode.index);
        accesses.unshift({ kind: "index", key });
      } else if (accessNode.kind === "member") {
        // For member access on structs
        const fieldName = accessNode.property as string;
        accesses.unshift({ kind: "member", fieldName });
      }

      current = accessNode.object;
    }

    // At the end, we should have an identifier that references storage
    if (Ast.Expression.isIdentifier(current)) {
      const name = (current as Ast.Expression.Identifier).name;
      const slot = yield* Process.Storage.findSlot(name);
      if (slot) {
        return { slot, accesses };
      }

      // Check if it's a local variable
      const local = yield* Process.Variables.lookup(name);
      if (local) {
        if (accesses.length > 0) {
          // Error: trying to access members/indices on a local variable
          const localType = yield* Process.Types.nodeType(current);
          const typeDesc = localType
            ? (localType as Type & { name?: string; kind?: string }).name ||
              (localType as Type & { name?: string; kind?: string }).kind ||
              "complex"
            : "unknown";

          yield* Process.Errors.report(
            new IrgenError(
              ErrorMessages.STORAGE_MODIFICATION_ERROR(name, typeDesc),
              expr.loc ?? undefined,
              Severity.Error,
            ),
          );
        }
        // Whether or not we have accesses, this is a local variable, not storage
        return undefined;
      }

      // Neither storage nor local - undefined identifier
      return undefined;
    }

    // Non-identifier base expressions
    if (accesses.length > 0) {
      // Error: trying to access members/indices on non-identifier base
      yield* Process.Errors.report(
        accesses.length > 0
          ? new IrgenError(
              ErrorMessages.UNSUPPORTED_STORAGE_PATTERN(
                "function return values",
              ),
              expr.loc || undefined,
              Severity.Error,
            )
          : new IrgenError(
              `Storage access chain must start with a storage variable identifier. ` +
                `Found ${current.type} at the base of the access chain.`,
              current.loc ?? undefined,
              Severity.Error,
            ),
      );
    }

    // Base is not an identifier and has no accesses - just return undefined
    return undefined;
  };

/**
 * Emit a storage chain load
 */
export function* emitStorageChainLoad(
  chain: StorageAccessChain,
  valueType: Ir.Type,
  loc: Ast.SourceLocation | undefined,
): Process<Ir.Value> {
  let currentSlot = Ir.Value.constant(BigInt(chain.slot.slot), {
    kind: "uint",
    bits: 256,
  });
  let currentType = chain.slot.type;

  // Process each access in the chain
  for (const access of chain.accesses) {
    if (access.kind === "index" && access.key) {
      // For mapping/array access
      const tempId = yield* Process.Variables.newTemp();

      if (currentType.kind === "mapping") {
        // Mapping access
        yield* Process.Instructions.emit(
          Ir.Instruction.ComputeSlot.mapping(
            currentSlot,
            access.key,
            currentType.key || { kind: "address" },
            tempId,
            loc,
          ),
        );
        currentType = currentType.value || { kind: "uint", bits: 256 };
      } else if (currentType.kind === "array") {
        // Array access - compute array slot with index
        yield* Process.Instructions.emit(
          Ir.Instruction.ComputeSlot.array(
            currentSlot,
            access.key,
            tempId,
            loc,
          ),
        );
        currentType = currentType.element || { kind: "uint", bits: 256 };
      }

      currentSlot = Ir.Value.temp(tempId, { kind: "uint", bits: 256 });
    } else if (access.kind === "member" && access.fieldName) {
      // For struct field access
      if (currentType.kind === "struct") {
        // currentType is an IR.Type with struct fields as an array
        const structType = currentType as {
          kind: "struct";
          name: string;
          fields: Ir.Type.StructField[];
        };
        const field = structType.fields.find(
          (f) => f.name === access.fieldName,
        );

        if (!field) {
          throw new Error(
            `Field ${access.fieldName} not found in struct ${structType.name}`,
          );
        }

        // Use the byte offset from the IR struct field
        const fieldOffset = field.offset;

        const tempId = yield* Process.Variables.newTemp();
        yield* Process.Instructions.emit(
          Ir.Instruction.ComputeSlot.field(
            currentSlot,
            fieldOffset,
            tempId,
            loc,
          ),
        );

        currentSlot = Ir.Value.temp(tempId, { kind: "uint", bits: 256 });
        currentType = field.type;
      }
    }
  }

  // Generate the final read instruction using new unified format
  const loadTempId = yield* Process.Variables.newTemp();
  yield* Process.Instructions.emit({
    kind: "read",
    location: "storage",
    slot: currentSlot,
    offset: Ir.Value.constant(0n, { kind: "uint", bits: 256 }),
    length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
    type: valueType,
    dest: loadTempId,
    loc,
  } as Ir.Instruction.Read);

  return Ir.Value.temp(loadTempId, valueType);
}

/**
 * Emit a storage chain assignment
 */
export function* emitStorageChainAssignment(
  chain: StorageAccessChain,
  value: Ir.Value,
  loc: Ast.SourceLocation | undefined,
): Process<void> {
  if (chain.accesses.length === 0) {
    // Direct storage assignment using new unified format
    yield* Process.Instructions.emit({
      kind: "write",
      location: "storage",
      slot: Ir.Value.constant(BigInt(chain.slot.slot), {
        kind: "uint",
        bits: 256,
      }),
      offset: Ir.Value.constant(0n, { kind: "uint", bits: 256 }),
      length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
      value,
      loc,
    } as Ir.Instruction.Write);
    return;
  }

  // Compute the final storage slot through the chain
  let currentSlot: Ir.Value = Ir.Value.constant(BigInt(chain.slot.slot), {
    kind: "uint",
    bits: 256,
  });
  let currentType = chain.slot.type;

  // Process each access in the chain to compute the final slot
  for (const access of chain.accesses) {
    if (access.kind === "index" && access.key) {
      // Mapping access: compute keccak256(key || slot)
      if (currentType.kind === "mapping") {
        const slotTemp = yield* Process.Variables.newTemp();
        yield* Process.Instructions.emit({
          kind: "compute_slot",
          slotKind: "mapping",
          base: currentSlot,
          key: access.key,
          keyType: currentType.key || { kind: "address" },
          dest: slotTemp,
          loc,
        } as Ir.Instruction.ComputeSlot);
        currentSlot = Ir.Value.temp(slotTemp, { kind: "uint", bits: 256 });
        currentType = (currentType as { kind: "mapping"; value: Ir.Type })
          .value;
      } else if (currentType.kind === "array") {
        // Array access - compute array slot with index
        const slotTemp = yield* Process.Variables.newTemp();
        yield* Process.Instructions.emit(
          Ir.Instruction.ComputeSlot.array(
            currentSlot,
            access.key,
            slotTemp,
            loc,
          ),
        );

        currentSlot = Ir.Value.temp(slotTemp, {
          kind: "uint",
          bits: 256,
        });
        currentType = (currentType as { kind: "array"; element: Ir.Type })
          .element;
      }
    } else if (access.kind === "member" && access.fieldName) {
      // Struct field access: add field offset
      if (currentType.kind === "struct") {
        const structType = currentType as {
          kind: "struct";
          name: string;
          fields: Ir.Type.StructField[];
        };
        const field = structType.fields.find(
          (f) => f.name === access.fieldName,
        );

        if (field) {
          // Use the precomputed byte offset from the struct layout
          const fieldOffset = field.offset;

          const offsetTemp = yield* Process.Variables.newTemp();
          yield* Process.Instructions.emit(
            Ir.Instruction.ComputeSlot.field(
              currentSlot,
              fieldOffset,
              offsetTemp,
              loc,
            ),
          );
          currentSlot = Ir.Value.temp(offsetTemp, {
            kind: "uint",
            bits: 256,
          });
          currentType = field.type;
        } else {
          yield* Process.Errors.report(
            new IrgenError(
              `Field ${access.fieldName} not found in struct ${structType.name}`,
              loc,
              Severity.Error,
            ),
          );
        }
      }
    }
  }

  // Store to the computed slot using new unified format
  yield* Process.Instructions.emit({
    kind: "write",
    location: "storage",
    slot: currentSlot,
    offset: Ir.Value.constant(0n, { kind: "uint", bits: 256 }),
    length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
    value,
    loc,
  } as Ir.Instruction.Write);
}

// export interface StorageAccessChain {
//   slot: Ir.Module.StorageSlot;
//   accesses: Array<{
//     kind: "index" | "member";
//     key?: Ir.Value; // For index access
//     fieldName?: string; // For member access
//     fieldIndex?: number; // For member access
//   }>;
// }

// /**
//  * Find a storage access chain starting from an expression (matching generator.ts)
//  */
// export const makeFindStorageAccessChain = (
//   buildExpression: (node: Ast.Expression) => IrGen<Ir.Value>,
// ) =>
//   function* findStorageAccessChain(
//     expr: Ast.Expression,
//   ): IrGen<StorageAccessChain | undefined> {
//     const accesses: StorageAccessChain["accesses"] = [];
//     let current = expr;

//     // Walk up the access chain from right to left
//     while (current.type === "AccessExpression") {
//       const accessNode = current as Ast.Expression.Access;

//       if (accessNode.kind === "index") {
//         // For index access, we need to evaluate the key expression
//         const key = yield* buildExpression(
//           accessNode.property as Ast.Expression,
//         );
//         accesses.unshift({ kind: "index", key });
//       } else {
//         // For member access on structs
//         const fieldName = accessNode.property as string;
//         accesses.unshift({ kind: "member", fieldName });
//       }

//       current = accessNode.object;
//     }

//     // At the end, we should have an identifier that references storage
//     if (current.type === "IdentifierExpression") {
//       const name = (current as Ast.Expression.Identifier).name;
//       const state = yield* peek();
//       const slot = state.module.storage.slots.find((s) => s.name === name);
//       if (slot) {
//         return { slot, accesses };
//       }

//       // Check if it's a local variable (which means we're trying to access
//       // storage through an intermediate variable - not supported)
//       const local = yield* lookupVariable(name);

//       if (local && accesses.length > 0) {
//         // Get the type to provide better error message
//         const localType = state.types.get(current.id);
//         const typeDesc = localType
//           ? (localType as Type & { name?: string; kind?: string }).name ||
//             (localType as Type & { name?: string; kind?: string }).kind ||
//             "complex"
//           : "unknown";

//         yield* addError(
//           new IrgenError(
//             ErrorMessages.STORAGE_MODIFICATION_ERROR(name, typeDesc),
//             expr.loc ?? undefined,
//             Severity.Error,
//           ),
//         );
//       }
//     } else if (current.type === "CallExpression") {
//       // Provide specific error for function calls
//       yield* addError(
//         new IrgenError(
//           ErrorMessages.UNSUPPORTED_STORAGE_PATTERN("function return values"),
//           expr.loc || undefined,
//           Severity.Error,
//         ),
//       );
//     } else if (accesses.length > 0) {
//       // Other unsupported base expressions when we have an access chain
//       yield* addError(
//         new IrgenError(
//           `Storage access chain must start with a storage variable identifier. ` +
//             `Found ${current.type} at the base of the access chain.`,
//           current.loc ?? undefined,
//           Severity.Error,
//         ),
//       );
//     }

//     return undefined;
//   };

// /**
//  * Find a storage variable from an expression
//  */
// export function* findStorageVariable(
//   expr: Ast.Expression,
// ): IrGen<Ir.Module.StorageSlot | undefined> {
//   if (expr.type === "IdentifierExpression") {
//     const name = (expr as Ast.Expression.Identifier).name;
//     const state = yield* peek();
//     return state.module.storage.slots.find((s) => s.name === name);
//   }
//   return undefined;
// }

// /**
//  * Emit a storage chain load (matching generator.ts pattern)
//  */
// export function* emitStorageChainLoad(
//   chain: StorageAccessChain,
//   valueType: Ir.Type,
//   loc: Ast.SourceLocation | undefined,
// ): IrGen<Ir.Value> {
//   let currentSlot = Ir.Value.constant(BigInt(chain.slot.slot), {
//     kind: "uint",
//     bits: 256,
//   });
//   let currentType = chain.slot.type;

//   // Process each access in the chain
//   for (const access of chain.accesses) {
//     if (access.kind === "index" && access.key) {
//       // For mapping/array access
//       const tempId = yield* newTemp();
//       yield* emit({
//         kind: "compute_slot",
//         baseSlot: currentSlot,
//         key: access.key,
//         dest: tempId,
//         loc,
//       } as Ir.Instruction);

//       currentSlot = Ir.Value.temp(tempId, { kind: "uint", bits: 256 });

//       // Update type based on mapping/array element type
//       if (currentType.kind === "mapping") {
//         currentType = currentType.value || { kind: "uint", bits: 256 };
//       } else if (currentType.kind === "array") {
//         currentType = currentType.element || { kind: "uint", bits: 256 };
//       }
//     } else if (access.kind === "member" && access.fieldName) {
//       // For struct field access
//       if (currentType.kind === "struct") {
//         const fieldIndex =
//           currentType.fields.findIndex(
//             ({ name }) => name === access.fieldName,
//           ) ?? 0;

//         const tempId = yield* newTemp();
//         yield* emit({
//           kind: "compute_field_offset",
//           baseSlot: currentSlot,
//           fieldIndex,
//           dest: tempId,
//           loc,
//         } as Ir.Instruction);

//         currentSlot = Ir.Value.temp(tempId, { kind: "uint", bits: 256 });
//         currentType = currentType.fields[fieldIndex]?.type || {
//           kind: "uint",
//           bits: 256,
//         };
//       }
//     }
//   }

//   // Generate the final load_storage instruction
//   const loadTempId = yield* newTemp();
//   yield* emit({
//     kind: "load_storage",
//     slot: currentSlot,
//     type: valueType,
//     dest: loadTempId,
//     loc,
//   } as Ir.Instruction.LoadStorage);

//   return Ir.Value.temp(loadTempId, valueType);
// }

// /**
//  * Emit a storage chain assignment
//  */
// export function* emitStorageChainAssignment(
//   chain: StorageAccessChain,
//   value: Ir.Value,
//   loc: Ast.SourceLocation | undefined,
// ): IrGen<void> {
//   if (chain.accesses.length === 0) {
//     // Direct storage assignment
//     yield* emit({
//       kind: "store_storage",
//       slot: Ir.Value.constant(BigInt(chain.slot.slot), {
//         kind: "uint",
//         bits: 256,
//       }),
//       value,
//       loc,
//     } as Ir.Instruction);
//     return;
//   }

//   // Compute the final storage slot through the chain
//   let currentSlot: Ir.Value = Ir.Value.constant(BigInt(chain.slot.slot), {
//     kind: "uint",
//     bits: 256,
//   });
//   let currentType = chain.slot.type;

//   // Process each access in the chain to compute the final slot
//   for (const access of chain.accesses) {
//     if (access.kind === "index" && access.key) {
//       // Mapping access: compute keccak256(key || slot)
//       if (currentType.kind === "mapping") {
//         const slotTemp = yield* newTemp();
//         yield* emit({
//           kind: "compute_slot",
//           baseSlot: currentSlot,
//           key: access.key,
//           dest: slotTemp,
//           loc,
//         } as Ir.Instruction);
//         currentSlot = Ir.Value.temp(slotTemp, { kind: "uint", bits: 256 });
//         currentType = (currentType as { kind: "mapping"; value: Ir.Type })
//           .value;
//       } else if (currentType.kind === "array") {
//         // Array access
//         const baseSlotTemp = yield* newTemp();
//         yield* emit({
//           kind: "compute_array_slot",
//           baseSlot: currentSlot,
//           dest: baseSlotTemp,
//           loc,
//         } as Ir.Instruction);

//         // Add the index to get the final slot
//         const finalSlotTemp = yield* newTemp();
//         yield* emit({
//           kind: "binary",
//           op: "add",
//           left: Ir.Value.temp(baseSlotTemp, { kind: "uint", bits: 256 }),
//           right: access.key,
//           dest: finalSlotTemp,
//           loc,
//         } as Ir.Instruction);

//         currentSlot = Ir.Value.temp(finalSlotTemp, {
//           kind: "uint",
//           bits: 256,
//         });
//         currentType = (currentType as { kind: "array"; element: Ir.Type })
//           .element;
//       }
//     } else if (access.kind === "member" && access.fieldName) {
//       // Struct field access: add field offset
//       if (currentType.kind === "struct") {
//         const structType = currentType as {
//           kind: "struct";
//           name: string;
//           fields: Ir.Type.StructField[];
//         };
//         const fieldIndex = structType.fields.findIndex(
//           (f) => f.name === access.fieldName,
//         );

//         if (fieldIndex >= 0) {
//           const offsetTemp = yield* newTemp();
//           yield* emit({
//             kind: "compute_field_offset",
//             baseSlot: currentSlot,
//             fieldIndex,
//             dest: offsetTemp,
//             loc,
//           } as Ir.Instruction);
//           currentSlot = Ir.Value.temp(offsetTemp, {
//             kind: "uint",
//             bits: 256,
//           });
//           currentType = structType.fields[fieldIndex].type;
//         } else {
//           yield* addError(
//             new IrgenError(
//               `Field ${access.fieldName} not found in struct ${structType.name}`,
//               loc,
//               Severity.Error,
//             ),
//           );
//         }
//       }
//     }
//   }

//   // Store to the computed slot
//   yield* emit({
//     kind: "store_storage",
//     slot: currentSlot,
//     value,
//     loc,
//   } as Ir.Instruction);
// }
