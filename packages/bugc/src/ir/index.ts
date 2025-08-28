/**
 * BUG-IR (Intermediate Representation) module
 *
 * This module provides the intermediate representation used between
 * the AST and final code generation phases.
 */

export * from "./ir";
export * from "./errors";
// Re-export analysis tools
export * from "./analysis";

// Re-export main types for convenience
export type { IrModule, IrFunction, BasicBlock, IrInstruction } from "./ir";
