import type * as Ast from "#ast";
import * as Ir from "#ir";
import type { Types } from "#types";
import { Type } from "#types";
import { Result, Severity } from "#result";
import type { IrState, PartialModule, FunctionContext } from "./state.js";
import { pipe } from "./builder.js";
import { operations } from "./operations.js";
import { buildBlock } from "./statements.js";
import { Error as IrgenError } from "./errors.js";
import { PhiInserter } from "./phi-inserter.js";

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
    const result = buildFunction(
      "create",
      [],
      undefined,
      program.create,
    )(state);
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
    const result = buildFunction("main", [], undefined, program.body)(state);
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
      const result = buildFunction(
        funcDecl.name,
        funcDecl.parameters,
        funcDecl.returnType,
        funcDecl.body,
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
  // Build storage layout with types
  const storage = buildStorageLayout(program, types);

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
    errors: [],
    warnings: [],
  };
}

/**
 * Build storage layout from declarations
 */
function buildStorageLayout(
  program: Ast.Program,
  types: Types,
): Ir.Module.StorageLayout {
  const slots: Ir.Module.StorageSlot[] = [];
  let nextSlot = 0;

  for (const decl of program.declarations) {
    if (decl.kind === "storage") {
      const storageDecl = decl as Ast.Declaration.Storage;

      // Get the type from the type checker for this storage declaration
      const storageType = types.get(storageDecl.id);

      if (storageType) {
        // Use mapTypeFromChecker to properly handle types with full struct info
        slots.push({
          name: storageDecl.name,
          slot: storageDecl.slot ?? nextSlot++,
          type: mapTypeFromChecker(storageType),
        });
      } else {
        // Fallback to AST type if type checker doesn't have it
        slots.push({
          name: storageDecl.name,
          slot: storageDecl.slot ?? nextSlot++,
          type: mapAstTypeToIrType(storageDecl.declaredType),
        });
      }
    }
  }

  return { slots };
}

/**
 * Map a type from the type checker to an IR type (with full struct field info)
 */
function mapTypeFromChecker(type: Type): Ir.Type {
  if (!type) {
    return { kind: "uint", bits: 256 };
  }

  switch (type.kind) {
    case "uint":
      return { kind: "uint", bits: type.bits || 256 };
    case "int":
      return { kind: "int", bits: type.bits || 256 };
    case "bool":
      return { kind: "bool" };
    case "address":
      return { kind: "address" };
    case "bytes":
      return { kind: "bytes", size: type.bits ? type.bits / 8 : 32 };
    case "string":
      return { kind: "bytes", size: 32 }; // Simplified
    case "array": {
      const arrayType = type as Type.Array;
      return {
        kind: "array",
        element: mapTypeFromChecker(arrayType.element),
        size: arrayType.size,
      } as Ir.Type;
    }
    case "mapping": {
      const mappingType = type as Type.Mapping;
      return {
        kind: "mapping",
        key: mapTypeFromChecker(mappingType.key),
        value: mapTypeFromChecker(mappingType.value),
      } as Ir.Type;
    }
    case "struct": {
      const structType = type as Type.Struct;
      const fields: Ir.Type.StructField[] = [];
      let offset = 0;
      for (const [name, fieldType] of structType.fields) {
        fields.push({
          name,
          type: mapTypeFromChecker(fieldType),
          offset,
        });
        offset += 32; // Simplified - each field takes 32 bytes
      }
      return {
        kind: "struct",
        name: structType.name,
        fields,
      } as Ir.Type;
    }
    default:
      return { kind: "uint", bits: 256 };
  }
}

/**
 * Build a function
 */
function buildFunction(
  name: string,
  parameters: Ast.FunctionParameter[],
  _returnType: Ast.Type | undefined,
  body: Ast.Block,
) {
  return (
    pipe<Ir.Function>()
      .then((state: IrState) => {
        // Create function context
        const functionContext: FunctionContext = {
          id: name,
          locals: [],
          blocks: new Map(),
        };

        // Update state with new function context
        const newState: IrState = {
          ...state,
          function: functionContext,
          block: {
            id: "entry",
            instructions: [],
            terminator: undefined,
            predecessors: new Set(),
            phis: [],
          },
          scopes: {
            stack: [{ locals: new Map(), usedNames: new Map() }],
          },
          counters: {
            temp: 0,
            block: 1, // Start at 1 to match test expectations
          },
        };

        return { state: newState, value: undefined };
      })
      // Add parameters as locals
      .then((state: IrState) => {
        let currentState = state;

        for (const param of parameters) {
          const paramType = mapAstTypeToIrType(param.type);
          const result = operations.declareLocal(
            param.name,
            paramType,
          )(currentState);
          currentState = result.state;
        }

        return { state: currentState, value: undefined };
      })
      // Build function body
      .then(buildBlock(body))
      // Ensure function has a terminator
      .then((state: IrState) => {
        if (!state.block.terminator) {
          // Add implicit return
          const result = operations.setTerminator({
            kind: "return",
            value: undefined,
          })(state);
          return result;
        }
        return { state, value: undefined };
      })
      // Sync final block
      .then(operations.syncBlock())
      // Create the function
      .then((state: IrState) => {
        const func: Ir.Function = {
          name,
          locals: state.function.locals,
          paramCount: parameters.length,
          entry: "entry",
          blocks: state.function.blocks,
        };

        return { state, value: func };
      })
      .done()
  );
}

/**
 * Map AST type to IR type
 */
function mapAstTypeToIrType(astType: Ast.Type): Ir.Type {
  if (astType.type === "ElementaryType") {
    const elem = astType as Ast.Type.Elementary;
    switch (elem.kind) {
      case "uint":
        return { kind: "uint", bits: elem.bits || 256 };
      case "int":
        return { kind: "int", bits: elem.bits || 256 };
      case "bool":
        return { kind: "bool" };
      case "address":
        return { kind: "address" };
      case "bytes":
        return { kind: "bytes", size: elem.bits ? elem.bits / 8 : 32 };
      case "string":
        return { kind: "bytes", size: 32 }; // Simplified
      default:
        return { kind: "uint", bits: 256 };
    }
  } else if (astType.type === "ComplexType") {
    const complex = astType as Ast.Type.Complex;
    switch (complex.kind) {
      case "array":
        if (complex.typeArgs && complex.typeArgs[0]) {
          return {
            kind: "array",
            element: mapAstTypeToIrType(complex.typeArgs[0]),
            size: complex.size,
          } as Ir.Type;
        }
        return { kind: "uint", bits: 256 };
      case "mapping":
        if (complex.typeArgs && complex.typeArgs.length >= 2) {
          return {
            kind: "mapping",
            key: mapAstTypeToIrType(complex.typeArgs[0]),
            value: mapAstTypeToIrType(complex.typeArgs[1]),
          } as Ir.Type;
        }
        return { kind: "mapping" } as Ir.Type;
      case "struct":
        // Struct types in AST don't have detailed field info
        // The actual struct details come from typechecker
        return {
          kind: "struct",
          name: "unknown",
          fields: [],
        } as Ir.Type;
      default:
        return { kind: "uint", bits: 256 };
    }
  } else if (astType.type === "ReferenceType") {
    // For type references, assume they refer to structs
    // The actual resolution happens during typechecking
    const ref = astType as Ast.Type.Reference;
    return { kind: "struct", name: ref.name, fields: [] } as Ir.Type;
  }

  return { kind: "uint", bits: 256 };
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
