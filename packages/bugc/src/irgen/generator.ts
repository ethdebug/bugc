import type * as Ast from "#ast";
import * as Ir from "#ir";
import type { Types } from "#types";
import { Result, Severity } from "#result";

import { Error as IrgenError } from "#irgen/errors";
import { fromBugType } from "#irgen/type";

import type { State } from "./generate/state.js";
import { Process } from "./generate/process.js";
import { buildModule } from "#irgen/generate";

/**
 * Generate IR from an AST program (public API)
 */
export function generateModule(
  program: Ast.Program,
  types: Types,
): Result<Ir.Module, IrgenError> {
  // Create initial state
  const initialState = createInitialState(program, types);

  // Run the generator
  const result = Process.run(buildModule(program, types), initialState);
  const { state, value: module } = result;

  // Check if there are any errors
  const hasErrors = state.errors.length > 0;

  // Build messages object
  const messages: Result<Ir.Module, IrgenError>["messages"] = {};

  if (state.errors.length > 0) {
    messages[Severity.Error] = state.errors;
  }

  if (state.warnings.length > 0) {
    messages[Severity.Warning] = state.warnings;
  }

  // Return Result based on whether there were errors
  if (hasErrors || !module) {
    return {
      success: false,
      messages,
    };
  }

  return {
    success: true,
    value: module,
    messages,
  };
}

/**
 * Create the initial IR generation state
 */
function createInitialState(program: Ast.Program, types: Types): State {
  // Create errors array to collect any type resolution errors
  const errors: IrgenError[] = [];

  // Build storage layout with types
  const storage = buildStorageLayout(program, types, errors);

  // Create initial module
  const module: State.Module = {
    name: program.name,
    storage,
    functions: new Map(),
  };

  // Create empty function context (will be replaced when building functions)
  const function_: State.Function = {
    id: "",
    locals: [],
    blocks: new Map(),
  };

  // Create initial block context
  const block = {
    id: "entry",
    instructions: [],
    terminator: undefined,
    predecessors: new Set<string>(),
    phis: [],
  };

  // Create initial scope
  const scopes = {
    stack: [{ locals: new Map(), usedNames: new Map() }],
  };

  // Create initial counters
  const counters = {
    temp: 0,
    block: 1, // Start at 1 to match test expectations
  };

  // Create empty loop stack
  const loops = {
    stack: [],
  };

  return {
    module,
    function: function_,
    block,
    scopes,
    loops,
    counters,
    types,
    errors,
    warnings: [],
  };
}

/**
 * Build storage layout from declarations
 */
function buildStorageLayout(
  program: Ast.Program,
  types: Types,
  errors: IrgenError[],
): Ir.Module.StorageLayout {
  const slots: Ir.Module.StorageSlot[] = [];
  let nextSlot = 0;

  for (const decl of program.declarations) {
    if (decl.kind === "storage") {
      const storageDecl = decl as Ast.Declaration.Storage;

      // Get the type from the type checker for this storage declaration
      const storageType = types.get(storageDecl.id);

      if (!storageType) {
        errors.push(
          new IrgenError(
            `Missing type information for storage variable: ${storageDecl.name}`,
            storageDecl.loc ?? undefined,
            Severity.Error,
          ),
        );
        continue;
      }

      slots.push({
        name: storageDecl.name,
        slot: storageDecl.slot ?? nextSlot++,
        type: fromBugType(storageType),
      });
    }
  }

  return { slots };
}
