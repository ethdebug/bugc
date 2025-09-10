import type { Ast, Ir } from "@ethdebug/bugc";

export interface BytecodeOutput {
  runtime: Uint8Array;
  create?: Uint8Array;
}

export interface SuccessfulCompileResult {
  success: true;
  ast: Ast.Program;
  ir: Ir.Module;
  optimizedIr: Ir.Module;
  bytecode: BytecodeOutput;
  warnings: string[];
}

export interface FailedCompileResult {
  success: false;
  error: string;
  ast?: Ast.Program;
  warnings?: string[];
}

export type CompileResult = SuccessfulCompileResult | FailedCompileResult;
