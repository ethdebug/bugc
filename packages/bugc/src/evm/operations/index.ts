/**
 * Type-safe EVM operations framework.
 *
 * This module provides a complete abstraction for EVM stack operations with
 * compile-time type safety. It includes:
 * - Stack type definitions and manipulation utilities
 * - State management with type-safe operation builders
 * - Instruction definitions and operation factories
 * - Type rebranding utilities
 * - Higher-kinded types for generic programming
 */

export { type Stack, type StackBrand } from "./stack";

export {
  type Instruction,
  type UnsafeStateControls,
  type StateControls,
  makeStateControls,
} from "./state";

export { type Operations, makeOperations } from "./definitions";

export { makeRebrands } from "./rebrand";

export { type Transition, makePipe } from "./builder";

export type { $, _ } from "./hkts";
