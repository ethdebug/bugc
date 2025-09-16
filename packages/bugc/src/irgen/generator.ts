import type * as Ast from "#ast";
import * as Ir from "#ir";
import type { Types } from "#types";
import { Type } from "#types";
import { Result, Severity } from "#result";
import type { IrState, PartialModule, FunctionContext } from "./state.js";
import { Error as IrgenError } from "./errors.js";
import { PhiInserter } from "./phi-inserter.js";
import { buildFunction } from "./function.js";
import { runGen, type IrGen, peek, addError, lift } from "./irgen.js";
import { mapTypeToIrType } from "./type.js";

/**
 * Generate IR from an AST program (generator version)
 */
function* generateModuleGen(
  program: Ast.Program,
  types: Types,
): IrGen<Ir.Module | undefined> {
  // Build constructor if present
  if (program.create) {
    const func = yield* withErrorHandling(
      buildFunction("create", [], program.create),
    );
    if (func && !isEmptyCreateFunction(func)) {
      yield* addFunctionToModule("create", func, "create");
    }
  }

  // Build main function if present
  if (program.body) {
    const func = yield* withErrorHandling(
      buildFunction("main", [], program.body),
    );
    if (func) {
      yield* addFunctionToModule("main", func, "main");
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
        yield* addError(
          new IrgenError(
            `Missing type information for function: ${funcDecl.name}`,
            funcDecl.loc ?? undefined,
            Severity.Error,
          ),
        );
        continue;
      }

      // Type checker has the function type - use it
      const parameters = funcDecl.parameters.map((param, index) => ({
        name: param.name,
        type: mapTypeToIrType(funcType.parameters[index]),
      }));

      const func = yield* withErrorHandling(
        buildFunction(funcDecl.name, parameters, funcDecl.body),
      );
      if (func) {
        yield* addFunctionToModule(funcDecl.name, func);
      }
    }
  }

  // Get final state and convert partial module to complete module
  const state = yield* peek();

  // Check if there are any errors
  if (state.errors.length > 0) {
    return undefined;
  }

  return new PhiInserter().insertPhiNodes({
    name: state.module.name,
    storage: state.module.storage,
    functions: state.module.functions,
    main: state.module.main || createEmptyFunction("main"),
    create: state.module.create,
  });
}

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
  const result = runGen(generateModuleGen(program, types))(initialState);
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
 * Add a function to the module state
 */
function* addFunctionToModule(
  name: string,
  func: Ir.Function,
  specialType?: "create" | "main",
): IrGen<void> {
  // Always add to functions map
  yield* addFunction(name, func);

  // Set special function reference if needed
  if (specialType === "create") {
    yield* setCreateFunction(func);
  } else if (specialType === "main") {
    yield* setMainFunction(func);
  }
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

/**
 * State update helpers - these simplify common state modifications
 */

/** Add a function to the module's function map */
function* addFunction(name: string, func: Ir.Function): IrGen<void> {
  yield* lift<void>((state: IrState) => ({
    state: {
      ...state,
      module: {
        ...state.module,
        functions: new Map([...state.module.functions, [name, func]]),
      },
    },
    value: undefined,
  }));
}

/** Set the special 'create' function */
function* setCreateFunction(func: Ir.Function): IrGen<void> {
  yield* lift<void>((state: IrState) => ({
    state: {
      ...state,
      module: {
        ...state.module,
        create: func,
      },
    },
    value: undefined,
  }));
}

/** Set the special 'main' function */
function* setMainFunction(func: Ir.Function): IrGen<void> {
  yield* lift<void>((state: IrState) => ({
    state: {
      ...state,
      module: {
        ...state.module,
        main: func,
      },
    },
    value: undefined,
  }));
}

/**
 * Error handling wrapper for generators
 */
function* withErrorHandling<T>(gen: IrGen<T>): IrGen<T | undefined> {
  const startState = yield* peek();
  const startErrorCount = startState.errors.length;

  // Run the generator
  const result = yield* gen;

  // Check if new errors were added
  const endState = yield* peek();
  const hasNewErrors = endState.errors.length > startErrorCount;

  if (hasNewErrors) {
    // If there were errors during execution, return undefined
    return undefined;
  }

  return result;
}

/**
 * Check if a create function is effectively empty
 */
function isEmptyCreateFunction(func: Ir.Function): boolean {
  const { blocks } = func;
  const entry = blocks.get("entry");

  return (
    blocks.size === 1 &&
    !!entry &&
    entry.instructions.length === 0 &&
    entry.terminator.kind === "return" &&
    !entry.terminator.value
  );
}
