import type { Type } from "./type.js";

/**
 * Ir value - either a constant or a reference to a temporary/local
 */
export type Value =
  | { kind: "const"; value: bigint | string | boolean; type: Type }
  | { kind: "temp"; id: string; type: Type }
  | { kind: "local"; name: string; type: Type };

export namespace Value {
  /**
   * Helper to create temporary value references
   */
  export function temp(id: string, type: Type): Value {
    return { kind: "temp", id, type };
  }

  /**
   * Helper to create constant values
   */
  export function constant(
    value: bigint | string | boolean,
    type: Type,
  ): Value {
    return { kind: "const", value, type };
  }

  /**
   * Helper to create local value references
   */
  export function local(name: string, type: Type): Value {
    return { kind: "local", name, type };
  }
}
