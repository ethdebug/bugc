/**
 * BUG-IR (Intermediate Representation) module
 *
 * This module provides the intermediate representation used between
 * the AST and final code generation phases.
 */

export * from "./ir.js";
export * from "./errors.js";
// Re-export analysis tools
export * from "./analysis/index.js";
