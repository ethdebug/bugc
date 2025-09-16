import type * as Ast from "#ast";
import * as Ir from "#ir";
import { Error as IrgenError } from "../errors.js";
import { Severity } from "#result";
import { buildExpression } from "../expressions/index.js";
import { type IrGen, addError, emit, peek, declareLocal } from "../irgen.js";
import { mapTypeToIrType } from "../type.js";

/**
 * Build a declaration statement
 */
export function* buildDeclarationStatement(
  stmt: Ast.Statement.Declare,
): IrGen<void> {
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
      return yield* addError(
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
): IrGen<void> {
  const state = yield* peek();

  // Infer type from the types map or use default
  const type = state.types.get(decl.id);
  const irType = type
    ? mapTypeToIrType(type)
    : ({ kind: "uint", bits: 256 } as Ir.Type);

  // Declare the local variable
  const local = yield* declareLocal(decl.name, irType);
  if (!local) {
    return;
  }

  // If there's an initializer, evaluate it and assign
  if (decl.initializer) {
    const value = yield* buildExpression(decl.initializer);
    yield* emit({
      kind: "store_local",
      local: local.id,
      value,
      loc: decl.loc ?? undefined,
    } as Ir.Instruction.StoreLocal);
  }
}
