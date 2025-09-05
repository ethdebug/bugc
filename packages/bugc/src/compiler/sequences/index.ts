/**
 * Concrete compilation sequences for different targets
 */

import { pass as parsingPass } from "../../parser/pass";
import { pass as typeCheckingPass } from "../../typechecker/pass";
import { pass as irGenerationPass } from "../../irgen/pass";
import { pass as optimizationPass } from "../../optimizer/pass";
import { pass as evmGenerationPass } from "../../evmgen/pass";

// AST-only sequence (just parsing)
export const astSequence = [parsingPass] as const;

// IR sequence (parsing through IR generation and optimization)
// Note: phi insertion is now integrated into irGenerationPass
export const irSequence = [
  parsingPass,
  typeCheckingPass,
  irGenerationPass,
  optimizationPass,
] as const;

// Bytecode sequence (parsing through bytecode generation)
export const bytecodeSequence = [...irSequence, evmGenerationPass] as const;

// Future sequences will go here:
// export const debugSequence = [...bytecodeSequence, debugGenerationPass] as const;

// Consolidated target sequences
export const targetSequences = {
  ast: astSequence,
  ir: irSequence,
  bytecode: bytecodeSequence,
  // debug: debugSequence,
} as const;

export type Target = keyof typeof targetSequences;
export type TargetSequence<T extends Target> = (typeof targetSequences)[T];
