/**
 * Compiler pass system for composing compilation passes
 */

// Re-export everything from submodules
export * from "./pass";
export * from "./sequence";
export * from "./sequences";

// Export new compile interface
export { compile, type CompileOptions } from "./compile";
