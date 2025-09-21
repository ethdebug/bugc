import type * as Ast from "#ast";
import * as Ir from "#ir";
import { Type } from "#types";
import { Process } from "../process.js";
import type { Context } from "./context.js";
import { buildExpression } from "./expression.js";

/**
 * Build IR for an array expression.
 * The behavior depends on the evaluation context:
 * - rvalue: allocate memory and initialize
 * - lvalue-storage: handled specially in assignment
 * - lvalue-memory: allocate and initialize in memory
 */
export function* buildArray(
  expr: Ast.Expression.Array,
  context: Context,
): Process<Ir.Value> {
  switch (context.kind) {
    case "lvalue-storage": {
      // Storage array assignment - expand to individual storage writes
      // First, store the array length at the base slot
      const lengthValue = Ir.Value.constant(BigInt(expr.elements.length), {
        kind: "uint",
        bits: 256,
      });
      yield* Process.Instructions.emit({
        kind: "write",
        location: "storage",
        slot: Ir.Value.constant(BigInt(context.slot), {
          kind: "uint",
          bits: 256,
        }),
        offset: Ir.Value.constant(0n, { kind: "uint", bits: 256 }),
        length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
        value: lengthValue,
        loc: expr.loc ?? undefined,
      } as Ir.Instruction.Write);

      // Then write each element
      for (let i = 0; i < expr.elements.length; i++) {
        // Generate the value for this element
        const elementValue = yield* buildExpression(expr.elements[i], {
          kind: "rvalue",
        });

        // Generate the index value
        const indexValue = Ir.Value.constant(BigInt(i), {
          kind: "uint",
          bits: 256,
        });

        // Compute slot for array[i]
        const slotTemp = yield* Process.Variables.newTemp();
        yield* Process.Instructions.emit(
          Ir.Instruction.ComputeSlot.array(
            Ir.Value.constant(BigInt(context.slot), {
              kind: "uint",
              bits: 256,
            }),
            indexValue,
            slotTemp,
            expr.loc ?? undefined,
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
          loc: expr.loc ?? undefined,
        } as Ir.Instruction.Write);
      }

      // Return a marker value since storage arrays don't have a memory address
      return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
    }

    case "lvalue-memory":
    case "rvalue": {
      // For memory contexts (both lvalue and rvalue), allocate and initialize
      const arrayType =
        context.kind === "lvalue-memory"
          ? context.type
          : yield* Process.Types.nodeType(expr);

      if (!arrayType || !Type.isArray(arrayType)) {
        // Fallback if type inference fails
        const elementCount = BigInt(expr.elements.length);
        const totalSize = 32n + elementCount * 32n;

        const basePtr = yield* Process.Variables.newTemp();
        yield* Process.Instructions.emit({
          kind: "allocate",
          location: "memory",
          size: Ir.Value.constant(totalSize, { kind: "uint", bits: 256 }),
          dest: basePtr,
          loc: expr.loc ?? undefined,
        } as Ir.Instruction.Allocate);

        // Store length
        yield* Process.Instructions.emit({
          kind: "write",
          location: "memory",
          offset: Ir.Value.temp(basePtr, { kind: "uint", bits: 256 }),
          length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
          value: Ir.Value.constant(elementCount, { kind: "uint", bits: 256 }),
          loc: expr.loc ?? undefined,
        } as Ir.Instruction.Write);

        // Calculate elements base (skip length field)
        const elementsBaseTemp = yield* Process.Variables.newTemp();
        yield* Process.Instructions.emit({
          kind: "binary",
          op: "add",
          left: Ir.Value.temp(basePtr, { kind: "uint", bits: 256 }),
          right: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
          dest: elementsBaseTemp,
          loc: expr.loc ?? undefined,
        } as Ir.Instruction);

        // Store each element
        for (let i = 0; i < expr.elements.length; i++) {
          const elementValue = yield* buildExpression(expr.elements[i], {
            kind: "rvalue",
          });

          const offsetTemp = yield* Process.Variables.newTemp();
          yield* Process.Instructions.emit({
            kind: "compute_offset",
            location: "memory",
            base: Ir.Value.temp(elementsBaseTemp, { kind: "uint", bits: 256 }),
            index: Ir.Value.constant(BigInt(i), { kind: "uint", bits: 256 }),
            stride: 32,
            dest: offsetTemp,
            loc: expr.loc ?? undefined,
          } as Ir.Instruction.ComputeOffset);

          yield* Process.Instructions.emit({
            kind: "write",
            location: "memory",
            offset: Ir.Value.temp(offsetTemp, { kind: "uint", bits: 256 }),
            length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
            value: elementValue,
            loc: expr.loc ?? undefined,
          } as Ir.Instruction.Write);
        }

        return Ir.Value.temp(basePtr, { kind: "uint", bits: 256 });
      }

      // Same implementation as above but with proper type
      const elementCount = BigInt(expr.elements.length);
      const totalSize = 32n + elementCount * 32n;

      const basePtr = yield* Process.Variables.newTemp();
      yield* Process.Instructions.emit({
        kind: "allocate",
        location: "memory",
        size: Ir.Value.constant(totalSize, { kind: "uint", bits: 256 }),
        dest: basePtr,
        loc: expr.loc ?? undefined,
      } as Ir.Instruction.Allocate);

      // Store length
      yield* Process.Instructions.emit({
        kind: "write",
        location: "memory",
        offset: Ir.Value.temp(basePtr, { kind: "uint", bits: 256 }),
        length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
        value: Ir.Value.constant(elementCount, { kind: "uint", bits: 256 }),
        loc: expr.loc ?? undefined,
      } as Ir.Instruction.Write);

      // Calculate elements base
      const elementsBaseTemp = yield* Process.Variables.newTemp();
      yield* Process.Instructions.emit({
        kind: "binary",
        op: "add",
        left: Ir.Value.temp(basePtr, { kind: "uint", bits: 256 }),
        right: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
        dest: elementsBaseTemp,
        loc: expr.loc ?? undefined,
      } as Ir.Instruction);

      // Store each element
      for (let i = 0; i < expr.elements.length; i++) {
        const elementValue = yield* buildExpression(expr.elements[i], {
          kind: "rvalue",
        });

        const offsetTemp = yield* Process.Variables.newTemp();
        yield* Process.Instructions.emit({
          kind: "compute_offset",
          location: "memory",
          base: Ir.Value.temp(elementsBaseTemp, { kind: "uint", bits: 256 }),
          index: Ir.Value.constant(BigInt(i), { kind: "uint", bits: 256 }),
          stride: 32,
          dest: offsetTemp,
          loc: expr.loc ?? undefined,
        } as Ir.Instruction.ComputeOffset);

        yield* Process.Instructions.emit({
          kind: "write",
          location: "memory",
          offset: Ir.Value.temp(offsetTemp, { kind: "uint", bits: 256 }),
          length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
          value: elementValue,
          loc: expr.loc ?? undefined,
        } as Ir.Instruction.Write);
      }

      return Ir.Value.temp(basePtr, { kind: "uint", bits: 256 });
    }
  }
}
