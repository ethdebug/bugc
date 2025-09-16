import type * as Ast from "#ast";
import * as Ir from "#ir";
import type { Types } from "#types";
import { Type } from "#types";
import { Result, Severity } from "#result";
import type { IrState, PartialModule, FunctionContext } from "./state.js";
import { Error as IrgenError } from "./errors.js";
import { PhiInserter } from "./phi-inserter.js";
import { buildFunction } from "./function.js";
import { runGen } from "./irgen.js";
import { mapTypeToIrType } from "./type.js";

/**
 * Generate IR from an AST program
 */
export function generateModule(
  program: Ast.Program,
  types: Types,
): Result<Ir.Module, IrgenError> {
  // Create initial state
  const initialState = createInitialState(program, types);

  // Build all functions
  let state = initialState;

  // Build constructor if present
  if (program.create) {
    const result = runGen(buildFunction("create", [], program.create))(state);
    state = result.state;

    if (result.value) {
      state = {
        ...state,
        module: {
          ...state.module,
          create: result.value,
          functions: new Map([
            ...state.module.functions,
            ["create", result.value],
          ]),
        },
      };
    }
  }

  // Build main function if present
  if (program.body) {
    const result = runGen(buildFunction("main", [], program.body))(state);
    state = result.state;

    if (result.value) {
      state = {
        ...state,
        module: {
          ...state.module,
          main: result.value,
          functions: new Map([
            ...state.module.functions,
            ["main", result.value],
          ]),
        },
      };
    }
  }

  // Build user-defined functions
  for (const decl of program.declarations) {
    if (decl.kind === "function") {
      const funcDecl = decl as Ast.Declaration.Function;

      // Map parameters to include their resolved types
      const funcType = types.get(funcDecl.id);

      // We expect the type checker to have validated this function
      if (!funcType || !Type.isFunction(funcType)) {
        state = {
          ...state,
          errors: [
            ...state.errors,
            new IrgenError(
              `Missing type information for function: ${funcDecl.name}`,
              funcDecl.loc ?? undefined,
              Severity.Error,
            ),
          ],
        };
        continue;
      }

      // Type checker has the function type - use it
      const parameters = funcDecl.parameters.map((param, index) => ({
        name: param.name,
        type: mapTypeToIrType(funcType.parameters[index]),
      }));

      const result = runGen(
        buildFunction(funcDecl.name, parameters, funcDecl.body),
      )(state);
      state = result.state;

      if (result.value) {
        state = {
          ...state,
          module: {
            ...state.module,
            functions: new Map([
              ...state.module.functions,
              [funcDecl.name, result.value],
            ]),
          },
        };
      }
    }
  }

  // Convert partial module to complete module
  const module: Ir.Module = new PhiInserter().insertPhiNodes({
    name: state.module.name,
    storage: state.module.storage,
    functions: state.module.functions,
    main: state.module.main || createEmptyFunction("main"),
    create: state.module.create,
  });

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
  if (hasErrors) {
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
function createInitialState(program: Ast.Program, types: Types): IrState {
  // Create errors array to collect any type resolution errors
  const errors: IrgenError[] = [];

  // Build storage layout with types
  const storage = buildStorageLayout(program, types, errors);

  // Create initial module
  const module: PartialModule = {
    name: program.name,
    storage,
    functions: new Map(),
  };

  // Create empty function context (will be replaced when building functions)
  const function_: FunctionContext = {
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

      // Use mapTypeToIrType to properly handle types with full struct info
      slots.push({
        name: storageDecl.name,
        slot: storageDecl.slot ?? nextSlot++,
        type: mapTypeToIrType(storageType),
      });
    }
  }

  return { slots };
}

/**
 * Create an empty function for cases where main is missing
 */
function createEmptyFunction(name: string): Ir.Function {
  return {
    name,
    locals: [],
    paramCount: 0,
    entry: "entry",
    blocks: new Map([
      [
        "entry",
        {
          id: "entry",
          instructions: [],
          phis: [],
          terminator: { kind: "return", value: undefined },
          predecessors: new Set(),
        },
      ],
    ]),
  };
}
