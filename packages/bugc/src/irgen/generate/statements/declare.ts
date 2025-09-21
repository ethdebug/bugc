import type * as Ast from "#ast";
import * as Ir from "#ir";
import { Severity } from "#result";
import { Type } from "#types";

import { Error as IrgenError } from "#irgen/errors";
import { fromBugType } from "#irgen/type";

import { buildExpression } from "../expressions/index.js";
import { Process } from "../process.js";

/**
 * Build a declaration statement
 */
export function* buildDeclarationStatement(
  stmt: Ast.Statement.Declare,
): Process<void> {
  const decl = stmt.declaration;

  switch (decl.kind) {
    case "variable":
      return yield* buildVariableDeclaration(decl as Ast.Declaration.Variable);
    case "function":
      // Function declarations are handled at module level
      return;
    case "struct":
      // Struct declarations are handled at module level
      return;
    case "storage":
      // Storage declarations are handled at module level
      return;
    default:
      return yield* Process.Errors.report(
        new IrgenError(
          `Unsupported declaration kind: ${decl.kind}`,
          stmt.loc ?? undefined,
          Severity.Error,
        ),
      );
  }
}

/**
 * Build a variable declaration
 */
function* buildVariableDeclaration(
  decl: Ast.Declaration.Variable,
): Process<void> {
  // Infer type from the types map or use default
  const type = yield* Process.Types.nodeType(decl);
  const irType = type
    ? fromBugType(type)
    : ({ kind: "uint", bits: 256 } as Ir.Type);

  // Check if this is a bytes type that needs memory allocation
  const needsMemoryAllocation =
    irType.kind === "bytes" ||
    irType.kind === "string" ||
    irType.kind === "array" ||
    irType.kind === "struct";

  if (needsMemoryAllocation) {
    // For types that need memory allocation

    // Calculate size needed
    let sizeValue: Ir.Value;
    if (irType.kind === "bytes" && irType.size) {
      // Fixed size bytes
      sizeValue = Ir.Value.constant(BigInt(irType.size), {
        kind: "uint",
        bits: 256,
      });
    } else if (decl.initializer && irType.kind === "bytes") {
      // Dynamic bytes with initializer - get size from the literal
      // Don't build the expression yet, just calculate size
      const initializerType = yield* Process.Types.nodeType(decl.initializer);
      if (
        initializerType &&
        Type.isElementary(initializerType) &&
        Type.Elementary.isBytes(initializerType)
      ) {
        // For hex literals, the size is (hex length - 2) / 2 (minus 0x, then 2 hex chars per byte)
        const hexLiteral = decl.initializer as Ast.Expression.Literal;
        if (
          hexLiteral.type === "LiteralExpression" &&
          hexLiteral.kind === "hex"
        ) {
          const hexValue = hexLiteral.value.startsWith("0x")
            ? hexLiteral.value.slice(2)
            : hexLiteral.value;
          const byteSize = hexValue.length / 2;
          sizeValue = Ir.Value.constant(BigInt(byteSize + 32), {
            kind: "uint",
            bits: 256,
          }); // Add 32 for length prefix
        } else {
          sizeValue = Ir.Value.constant(64n, { kind: "uint", bits: 256 }); // Default size
        }
      } else {
        sizeValue = Ir.Value.constant(64n, { kind: "uint", bits: 256 }); // Default size
      }
    } else {
      // Default size for dynamic types
      sizeValue = Ir.Value.constant(64n, { kind: "uint", bits: 256 });
    }

    // Allocate memory
    const allocTemp = yield* Process.Variables.newTemp();
    yield* Process.Instructions.emit({
      kind: "allocate",
      location: "memory",
      size: sizeValue,
      dest: allocTemp,
      loc: decl.loc ?? undefined,
    } as Ir.Instruction);

    // Declare the SSA variable and directly use the allocTemp as its value
    yield* Process.Variables.declareWithExistingTemp(
      decl.name,
      irType,
      allocTemp,
    );

    // If there's an initializer, store the value in memory
    if (decl.initializer) {
      const value = yield* buildExpression(decl.initializer, {
        kind: "rvalue",
      });

      if (irType.kind === "bytes") {
        // Check if it's a hex literal or a slice expression
        if (decl.initializer.type === "LiteralExpression") {
          const hexLiteral = decl.initializer as Ast.Expression.Literal;
          if (hexLiteral.kind === "hex") {
            const hexValue = hexLiteral.value.startsWith("0x")
              ? hexLiteral.value.slice(2)
              : hexLiteral.value;
            const byteSize = hexValue.length / 2;

            // Store length at the beginning
            yield* Process.Instructions.emit({
              kind: "write",
              location: "memory",
              offset: Ir.Value.temp(allocTemp, {
                kind: "uint",
                bits: 256,
              }),
              length: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
              value: Ir.Value.constant(BigInt(byteSize), {
                kind: "uint",
                bits: 256,
              }),
              loc: decl.loc ?? undefined,
            } as Ir.Instruction.Write);

            // Store the actual bytes data after the length
            const dataOffsetTemp = yield* Process.Variables.newTemp();
            yield* Process.Instructions.emit({
              kind: "binary",
              op: "add",
              left: Ir.Value.temp(allocTemp, {
                kind: "uint",
                bits: 256,
              }),
              right: Ir.Value.constant(32n, { kind: "uint", bits: 256 }),
              dest: dataOffsetTemp,
              loc: decl.loc ?? undefined,
            } as Ir.Instruction.BinaryOp);

            yield* Process.Instructions.emit({
              kind: "write",
              location: "memory",
              offset: Ir.Value.temp(dataOffsetTemp, {
                kind: "uint",
                bits: 256,
              }),
              length: Ir.Value.constant(BigInt(byteSize), {
                kind: "uint",
                bits: 256,
              }),
              value: value,
              loc: decl.loc ?? undefined,
            } as Ir.Instruction.Write);
          }
        } else {
          // For slice expressions and other bytes operations,
          // the value is already a reference to memory
          // We need to copy the slice result to the new allocation
          // This is a simplified version - a full implementation would need to
          // handle different cases more carefully

          // If the value is a temp, update the SSA variable to point to it
          if (value.kind === "temp") {
            yield* Process.Variables.updateSsaToExistingTemp(
              decl.name,
              value.id,
              irType,
            );
          } else {
            // For non-temp values, we need to copy it
            yield* Process.Instructions.emit({
              kind: "binary",
              op: "add",
              left: value,
              right: Ir.Value.constant(0n, { kind: "uint", bits: 256 }),
              dest: allocTemp,
              loc: decl.loc ?? undefined,
            } as Ir.Instruction.BinaryOp);
          }
        }
      }
    }
  } else {
    // Original logic for non-memory types
    if (decl.initializer) {
      const value = yield* buildExpression(decl.initializer, {
        kind: "rvalue",
      });
      const ssaVar = yield* Process.Variables.declare(decl.name, irType);

      // Generate assignment to the new SSA temp
      if (value.kind === "temp") {
        // If value is already a temp, just update SSA to use it
        if (value.id !== ssaVar.currentTempId) {
          yield* Process.Variables.updateSsaToExistingTemp(
            decl.name,
            value.id,
            irType,
          );
        }
      } else if (value.kind === "const") {
        // Create const instruction for constants
        yield* Process.Instructions.emit({
          kind: "const",
          value: value.value,
          type: irType,
          dest: ssaVar.currentTempId,
          loc: decl.loc ?? undefined,
        } as Ir.Instruction.Const);
      }
    } else {
      // No initializer - declare with default value
      const ssaVar = yield* Process.Variables.declare(decl.name, irType);
      yield* Process.Instructions.emit({
        kind: "const",
        value: 0n,
        type: irType,
        dest: ssaVar.currentTempId,
        loc: decl.loc ?? undefined,
      } as Ir.Instruction.Const);
    }
  }
}
