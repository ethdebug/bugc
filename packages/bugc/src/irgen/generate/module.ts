import type * as Ast from "#ast";
import * as Ir from "#ir";
import type { Types } from "#types";
import { Type } from "#types";
import { Severity } from "#result";

import { Error as IrgenError } from "#irgen/errors";
import { fromBugType } from "#irgen/type";

import { State } from "./state.js";
import { PhiInserter } from "../phi-inserter.js";
import { buildFunction } from "./function.js";
import { Process } from "./process.js";

/**
 * Generate IR from an AST program (generator version)
 */
export function* buildModule(
  program: Ast.Program,
  types: Types,
): Process<Ir.Module | undefined> {
  // Build constructor if present
  if (program.create) {
    const func = yield* withErrorHandling(
      buildFunction("create", [], program.create),
    );
    if (func && !isEmptyCreateFunction(func)) {
      yield* Process.Functions.addToModule(State.Module.create, func);
    }
  }

  // Build main function if present
  if (program.body) {
    const func = yield* withErrorHandling(
      buildFunction("main", [], program.body),
    );
    if (func) {
      yield* Process.Functions.addToModule(State.Module.main, func);
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
        yield* Process.Errors.report(
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
        type: fromBugType(funcType.parameters[index]),
      }));

      const func = yield* withErrorHandling(
        buildFunction(funcDecl.name, parameters, funcDecl.body),
      );
      if (func) {
        yield* Process.Functions.addToModule(funcDecl.name, func);
      }
    }
  }

  // Check if there are any errors
  const hasErrors = (yield* Process.Errors.count()) > 0;
  if (hasErrors) {
    return undefined;
  }

  // Get module state to build final IR module
  const module_ = yield* Process.Modules.current();

  const result = new PhiInserter().insertPhiNodes({
    ...module_,
    main: module_.main || createEmptyFunction("main"),
  });

  return result;
}

/**
 * Error handling wrapper for generators
 */
function* withErrorHandling<T>(gen: Process<T>): Process<T | undefined> {
  const startCount = yield* Process.Errors.count();

  // Run the generator
  const result = yield* gen;

  // Check if new errors were added
  const endCount = yield* Process.Errors.count();
  const hasNewErrors = endCount > startCount;

  if (hasNewErrors) {
    // If there were errors during execution, return undefined
    return undefined;
  }

  return result;
}

/**
 * Create an empty function for cases where main is missing
 */
function createEmptyFunction(name: string): Ir.Function {
  return {
    name,
    parameters: [],
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
