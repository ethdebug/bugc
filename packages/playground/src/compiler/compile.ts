import { compile as bugCompile, type BugError, Severity } from "@ethdebug/bugc";
import type { CompileResult } from "./types";

export async function compile(
  code: string,
  optimizationLevel: number,
): Promise<CompileResult> {
  console.debug("compiling %o", bugCompile);
  // First, get the AST
  const astResult = await bugCompile({ to: "ast", source: code });
  console.debug("astResult %o", astResult);

  if (!astResult.success) {
    const errors = astResult.messages[Severity.Error] || [];
    const warnings = astResult.messages[Severity.Warning] || [];
    return {
      success: false,
      error: errors[0]?.message || "Parse failed",
      warnings: warnings.map((w: BugError) => w.message),
    };
  }

  const ast = astResult.value.ast;

  // Get unoptimized IR
  const irResult = await bugCompile({
    to: "ir",
    source: code,
    optimizer: { level: 0 },
  });

  if (!irResult.success) {
    const errors = irResult.messages[Severity.Error] || [];
    const warnings = irResult.messages[Severity.Warning] || [];
    return {
      success: false,
      error: errors[0]?.message || "IR generation failed",
      ast,
      warnings: warnings.map((w: BugError) => w.message),
    };
  }

  const ir = irResult.value.ir;

  // Get optimized IR if optimization is requested
  let optimizedIr = ir;
  if (optimizationLevel > 0) {
    const optimizedResult = await bugCompile({
      to: "ir",
      source: code,
      optimizer: { level: optimizationLevel as 0 | 1 | 2 | 3 },
    });

    if (optimizedResult.success) {
      optimizedIr = optimizedResult.value.ir;
    }
  }

  // Generate bytecode with optimization
  const bytecodeResult = await bugCompile({
    to: "bytecode",
    source: code,
    optimizer: { level: optimizationLevel as 0 | 1 | 2 | 3 },
  });

  if (!bytecodeResult.success) {
    const errors = bytecodeResult.messages[Severity.Error] || [];
    const warnings = bytecodeResult.messages[Severity.Warning] || [];
    return {
      success: false,
      error: errors[0]?.message || "Bytecode generation failed",
      ast,
      warnings: warnings.map((w: BugError) => w.message),
    };
  }

  const bytecode = bytecodeResult.value.bytecode;

  // Collect all warnings
  const allWarnings = [
    ...(astResult.messages[Severity.Warning] || []),
    ...(irResult.messages[Severity.Warning] || []),
    ...(bytecodeResult.messages[Severity.Warning] || []),
  ].map((w: BugError) => w.message);

  return {
    success: true,
    ast,
    symbolTable: undefined, // Not available in new interface
    ir,
    optimizedIr,
    bytecode,
    warnings: [...new Set(allWarnings)], // Remove duplicates
  };
}
