import type * as Ast from "#ast";

/**
 * Bindings map identifier AST nodes to their declaration sites.
 *
 * This is a flat, global mapping that records where each identifier
 * in the program was declared. Unlike the symbol table, this is not
 * scope-aware - it's just a simple lookup table.
 *
 * The keys are AST IDs of identifier nodes (where symbols are used).
 * The values are declaration nodes (where symbols are declared).
 */
export type Bindings = Map<Ast.Id, Ast.Declaration>;

/**
 * Create an empty bindings map
 */
export function emptyBindings(): Bindings {
  return new Map();
}

/**
 * Record a binding from an identifier use to its declaration
 */
export function recordBinding(
  bindings: Bindings,
  identifierId: Ast.Id,
  declaration: Ast.Declaration,
): Bindings {
  const updated = new Map(bindings);
  updated.set(identifierId, declaration);
  return updated;
}

/**
 * Merge multiple bindings maps
 */
export function mergeBindings(...bindingMaps: Bindings[]): Bindings {
  const merged = new Map<Ast.Id, Ast.Declaration>();
  for (const bindings of bindingMaps) {
    for (const [id, decl] of bindings) {
      merged.set(id, decl);
    }
  }
  return merged;
}
