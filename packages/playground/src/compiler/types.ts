import type { Program, IrModule, SymbolTable } from "@ethdebug/bugc";

export interface BytecodeOutput {
  runtime: Uint8Array;
  create?: Uint8Array;
}

export interface SuccessfulCompileResult {
  success: true;
  ast: Program;
  symbolTable?: SymbolTable;
  ir: IrModule;
  optimizedIr: IrModule;
  bytecode: BytecodeOutput;
  warnings: string[];
}

export interface FailedCompileResult {
  success: false;
  error: string;
  ast?: Program;
  warnings?: string[];
}

export type CompileResult = SuccessfulCompileResult | FailedCompileResult;
