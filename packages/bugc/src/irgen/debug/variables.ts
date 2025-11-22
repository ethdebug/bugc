/**
 * Variable collection utilities for ethdebug/format integration
 *
 * Collects variable information for generating variables contexts
 */

import * as Format from "@ethdebug/format";
import type { State } from "../generate/state.js";
import { generatePointer, type VariableLocation } from "./pointers.js";

/**
 * Information about a variable available for debug contexts
 */
export interface VariableInfo {
  /** Variable identifier (name) */
  identifier: string;

  /** Type information */
  type?: Format.Type;

  /** Runtime location pointer */
  pointer?: Format.Pointer;

  /** Declaration location in source */
  declaration?: Format.Materials.SourceRange;
}

/**
 * Collect all variables with determinable locations from current state
 *
 * At IR generation time, we can only include variables that have
 * concrete runtime locations:
 * - Storage variables (fixed or computed slots)
 * - Memory allocations (if tracked)
 *
 * SSA temps are NOT included because they don't have concrete runtime
 * locations until EVM code generation.
 */
export function collectVariablesWithLocations(
  state: State,
  sourceId: string,
): VariableInfo[] {
  const variables: VariableInfo[] = [];

  // Collect storage variables - these have fixed/known slots
  for (const storageDecl of state.module.storageDeclarations) {
    const location: VariableLocation = {
      kind: "storage",
      slot: storageDecl.slot,
    };

    const pointer = generatePointer(location);
    if (!pointer) continue;

    // TODO: Get resolved type from typechecker's type map
    // For now, we skip the type since storageDecl.type is an AST type
    // and we need the resolved BugType from the typechecker
    const type = undefined;

    const declaration: Format.Materials.SourceRange | undefined =
      storageDecl.loc
        ? {
            source: { id: sourceId },
            range: storageDecl.loc,
          }
        : undefined;

    variables.push({
      identifier: storageDecl.name,
      type,
      pointer,
      declaration,
    });
  }

  // TODO: Add memory-allocated variables when we track memory allocations
  // For now, we skip memory variables as we don't track their offsets yet

  // Note: We do NOT include SSA temps here because they don't have
  // concrete runtime locations (stack positions) until EVM codegen

  return variables;
}

/**
 * Convert VariableInfo to ethdebug/format variable context entry
 */
export function toVariableContextEntry(
  variable: VariableInfo,
): Format.Program.Context.Variables["variables"][number] {
  const entry: Format.Program.Context.Variables["variables"][number] = {
    identifier: variable.identifier,
  };

  if (variable.type) {
    entry.type = variable.type;
  }

  if (variable.pointer) {
    entry.pointer = variable.pointer;
  }

  if (variable.declaration) {
    entry.declaration = variable.declaration;
  }

  return entry;
}
