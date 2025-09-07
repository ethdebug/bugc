export const VERSION = "0.1.0";

// Re-export parser functionality
export { parse, parser } from "#parser";

// Re-export AST types
export type { Program, AstNode, SourceLocation } from "#ast";

// Re-export type checker functionality
export { TypeChecker, createTypeChecker } from "#typechecker";

// Re-export type system
export {
  ElementaryType,
  ArrayType,
  MappingType,
  StructType,
  FunctionType,
  ErrorType,
  Types,
  SymbolTable,
} from "#types";
export type { Type, TypeKind, BugSymbol, TypeMap } from "#types";

// Re-export IR functionality
export * as Ir from "#ir";

// Re-export IR generation functionality
export { IrBuilder } from "#irgen";

// Re-export optimizer functionality
export { optimizeIr } from "#optimizer";
export type { OptimizationLevel } from "#optimizer";

// Re-export error handling utilities
export * from "#errors";

// Re-export result type
export * from "#result";

// Re-export compiler interfaces
export { compile, type CompileOptions } from "#compiler";

// Re-export EVM functionality
export * as Evm from "#evm";

// CLI utilities are not exported to avoid browser compatibility issues
// They should be imported directly from ./cli when needed in Node.js environments
