import type * as Ast from "#ast";
import * as Ir from "#ir";
import { Severity } from "#result";

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

  // If there's an initializer, evaluate it and create SSA variable
  if (decl.initializer) {
    const value = yield* buildExpression(decl.initializer, { kind: "rvalue" });
    const ssaVar = yield* Process.Variables.declare(decl.name, irType);

    // Generate assignment to the new SSA temp
    if (value.kind === "temp" && value.id !== ssaVar.currentTempId) {
      // Copy from existing temp
      yield* Process.Instructions.emit({
        kind: "binary",
        op: "add",
        left: value,
        right: Ir.Value.constant(0n, irType),
        dest: ssaVar.currentTempId,
        loc: decl.loc ?? undefined,
      } as Ir.Instruction.BinaryOp);
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
