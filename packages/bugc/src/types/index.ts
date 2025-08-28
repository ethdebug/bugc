/**
 * Type system for the BUG language
 *
 * This module contains the core type definitions used throughout the compiler.
 * It is separate from the typechecker to allow other modules to use types
 * without depending on the checking logic.
 */

// Re-export all type definitions
export * from "./definitions";
export * from "./factories";
export * from "./symbol-table";

// Type alias for the mapping of AST nodes to their types
import type { Type } from "./definitions";
export type TypeMap = WeakMap<object, Type>;
