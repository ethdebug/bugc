import type * as Ast from "#ast";
import * as Ir from "#ir";
import type { Process } from "../process.js";

/**
 * Build IR for an array expression.
 * For now, array expressions are only used in assignments to storage arrays,
 * where they get expanded to individual element writes.
 * In the future, this could allocate memory and return a pointer.
 */
export function* buildArray(_expr: Ast.Expression.Array): Process<Ir.Value> {
  // For now, we'll just return a placeholder value
  // The actual expansion happens in the assignment handling
  // when we detect an array expression being assigned to a storage array

  // This is a temporary implementation that returns a marker value
  // Real implementation would allocate memory for the array
  return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
}
