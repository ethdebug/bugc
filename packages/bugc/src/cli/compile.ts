/**
 * BUG compiler CLI implementation
 */
/* eslint-disable no-console */

import { parseArgs } from "util";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  commonOptions,
  optimizationOption,
  parseOptimizationLevel,
} from "./options";
import { displayErrors, displayWarnings } from "./output";
import { formatJson, formatIrText } from "./formatters";
import { IrValidator, IrStats, IrFormatter } from "../ir/analysis";
import { EvmFormatter } from "../evm/analysis";
import type { IrModule } from "../ir";
import type { Program } from "../ast";
import type { EvmGenerationOutput } from "../evmgen/pass";
import { compile } from "../compiler";
import { Result } from "../result";
import type { BugError } from "../errors";


type Phase = "ast" | "ir" | "bytecode";

// Helper type to represent the compiler output
type CompilerOutput<T extends Phase> = T extends "ast"
  ? { ast: Program }
  : T extends "ir"
    ? { ast: Program; ir: IrModule }
    : T extends "bytecode"
      ? {
          ast: Program;
          ir: IrModule;
          bytecode: EvmGenerationOutput;
        }
      : never;

const compileOptions = {
  ...optimizationOption,
  "stop-after": {
    type: "string" as const,
    short: "s",
    default: "bytecode",
  },
  format: {
    type: "string" as const,
    short: "f",
    default: "text",
  },
  "show-both": {
    type: "boolean" as const,
    default: false,
  },
  stats: {
    type: "boolean" as const,
    default: false,
  },
  validate: {
    type: "boolean" as const,
    default: false,
  },
  pretty: {
    type: "boolean" as const,
    short: "p",
    default: false,
  },
};

export async function handleCompileCommand(args: string[]): Promise<void> {
  const allOptions = { ...commonOptions, ...compileOptions };

  const { values, positionals } = parseArgs({
    args: args.slice(2), // Skip 'node' and 'bugc'
    options: allOptions,
    allowPositionals: true,
  });

  // Cast values to include all possible properties
  const parsedValues = values as {
    help?: boolean;
    output?: string;
    optimize?: string;
    "stop-after"?: string;
    format?: string;
    "show-both"?: boolean;
    stats?: boolean;
    validate?: boolean;
    pretty?: boolean;
  };

  if (parsedValues.help || positionals.length === 0) {
    showHelp();
    process.exit(0);
  }

  try {
    // Validate arguments
    const phase = String(parsedValues["stop-after"] || "bytecode") as Phase;
    if (!["ast", "ir", "bytecode"].includes(phase)) {
      throw new Error("--stop-after must be one of: ast, ir, bytecode");
    }

    const format = String(parsedValues.format || "text");
    if (!["text", "json", "asm"].includes(format)) {
      throw new Error("--format must be 'text', 'json', or 'asm'");
    }

    // Read source file
    const filePath = resolve(positionals[0]);
    const source = readFileSync(filePath, "utf-8");

    // Compile using new interface
    const optimizationLevel = parseOptimizationLevel(
      String(parsedValues.optimize || "0"),
    );

    // Call compile with properly typed options based on phase
    const result = await compileForPhase(
      phase,
      source,
      filePath,
      optimizationLevel,
    );

    if (!result.success) {
      displayErrors(result.messages, source);
      process.exit(1);
    }
    displayWarnings(result.messages, source);

    // Format output
    const output = formatOutput(result.value, phase, format, parsedValues);

    // Write output
    if (parsedValues.output) {
      writeFileSync(parsedValues.output, output);
    } else {
      console.log(output);
    }

    // Post-process if needed
    await postProcess(result.value, phase, { ...parsedValues, filePath });
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

function showHelp(): void {
  console.log(`Usage: bugc [options] <file>

Compile BUG source code with configurable output phase

Options:
  -s, --stop-after <phase>  Stop compilation after phase (ast, ir, bytecode)
                           Default: bytecode
  -O, --optimize <level>    Set optimization level (0-3)
                           Default: 0
  -f, --format <format>     Output format (text, json, asm)
                           Default: text
  -o, --output <file>       Write output to file instead of stdout
  -p, --pretty             Pretty-print JSON output
  --validate               Validate IR output
  --stats                  Show IR statistics
  --show-both              Show both unoptimized and optimized IR
  -h, --help               Show this help message`);
}

// Helper function to compile with proper types
async function compileForPhase<T extends Phase>(
  phase: T,
  source: string,
  filePath: string,
  optimizationLevel: number,
): Promise<Result<CompilerOutput<T>, BugError>> {
  if (phase === "ast") {
    const result = await compile({
      to: "ast",
      source,
      sourcePath: filePath,
    });
    return result as Result<CompilerOutput<T>, BugError>;
  } else if (phase === "ir") {
    const result = await compile({
      to: "ir",
      source,
      optimizer: {
        level: optimizationLevel as 0 | 1 | 2 | 3,
      },
      sourcePath: filePath,
    });
    return result as Result<CompilerOutput<T>, BugError>;
  } else {
    const result = await compile({
      to: "bytecode",
      source,
      optimizer: {
        level: optimizationLevel as 0 | 1 | 2 | 3,
      },
      sourcePath: filePath,
    });
    return result as Result<CompilerOutput<T>, BugError>;
  }
}

function formatOutput<T extends Phase>(
  result: CompilerOutput<T>,
  phase: T,
  format: string,
  values: Record<string, unknown>,
): string {
  switch (phase) {
    case "ast":
      return formatAst(
        (result as CompilerOutput<"ast">).ast,
        format,
        values.pretty as boolean,
      );
    case "ir":
      return formatIr((result as CompilerOutput<"ir">).ir, format);
    case "bytecode":
      return formatBytecode(
        (result as CompilerOutput<"bytecode">).bytecode,
        format,
        values.pretty as boolean,
      );
    default:
      return "";
  }
}

async function postProcess<T extends Phase>(
  result: CompilerOutput<T>,
  phase: T,
  values: Record<string, unknown> & { filePath?: string },
): Promise<void> {
  switch (phase) {
    case "ir":
      if ("ir" in result) {
        await postProcessIr(result.ir, values);
      }
      break;
  }
}

// Formatting functions
function formatAst(ast: Program, format: string, pretty: boolean): string {
  if (format === "json") {
    return formatJson(ast, pretty);
  } else {
    // For text format, show the AST structure
    return formatJson(ast, true);
  }
}

function formatIr(ir: IrModule, format: string): string {
  if (format === "json") {
    return formatJson(ir, false);
  } else {
    return formatIrText(ir);
  }
}

function formatBytecode(
  bytecode: EvmGenerationOutput,
  format: string,
  pretty: boolean,
): string {
  if (format === "json") {
    // For JSON, return the bytecode as hex strings
    const output = {
      runtime: "0x" + Buffer.from(bytecode.runtime).toString("hex"),
      create: bytecode.create
        ? "0x" + Buffer.from(bytecode.create).toString("hex")
        : undefined,
    };
    return formatJson(output, pretty);
  } else if (format === "asm") {
    // For asm format, use the instruction objects directly
    let output = `; Runtime bytecode (${bytecode.runtime.length} bytes)\n`;
    output += EvmFormatter.formatInstructions(bytecode.runtimeInstructions);

    if (bytecode.create && bytecode.createInstructions) {
      output += `\n\n; Creation bytecode (${bytecode.create.length} bytes)\n`;
      output += EvmFormatter.formatInstructions(bytecode.createInstructions);
    }

    return output;
  } else {
    // For text format, show hex strings with labels
    const runtimeHex = "0x" + Buffer.from(bytecode.runtime).toString("hex");
    const createHex = bytecode.create
      ? "0x" + Buffer.from(bytecode.create).toString("hex")
      : undefined;

    let output = `Runtime bytecode (${bytecode.runtime.length} bytes):\n${runtimeHex}\n`;

    if (createHex) {
      output += `\nCreation bytecode (${bytecode.create!.length} bytes):\n${createHex}\n`;
    }

    return output;
  }
}

// Post-processing functions
async function postProcessIr(
  ir: IrModule,
  args: Record<string, unknown> & { filePath?: string },
): Promise<void> {
  // Handle --validate flag
  if (args.validate) {
    validateIr(ir);
  }

  // Handle --stats flag
  if (args.stats) {
    showStats(ir);
  }

  // Handle --show-both flag
  const optimizationLevel = parseOptimizationLevel(
    String(args.optimize || "0"),
  );
  if (args["show-both"] && optimizationLevel > 0) {
    const filePath =
      args.filePath || resolve(process.argv[process.argv.length - 1]);
    const source = readFileSync(filePath, "utf-8");
    await showBothVersions(
      source,
      optimizationLevel,
      String(args.format),
      filePath,
    );
  }
}

function validateIr(ir: IrModule): void {
  const validator = new IrValidator();
  const validationResult = validator.validate(ir);

  if (!validationResult.isValid) {
    console.error("IR Validation Failed:");
    for (const error of validationResult.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  if (validationResult.warnings.length > 0) {
    console.error("IR Validation Warnings:");
    for (const warning of validationResult.warnings) {
      console.error(`  - ${warning}`);
    }
  }

  console.error("✓ IR validation passed");
  console.error("");
}

function showStats(ir: IrModule): void {
  const stats = new IrStats();
  const statistics = stats.analyze(ir);

  console.log("=== IR Statistics ===");
  console.log(`Blocks: ${statistics.blockCount}`);
  console.log(`Instructions: ${statistics.instructionCount}`);
  console.log(`Temporaries: ${statistics.tempCount}`);
  console.log(`Locals: ${statistics.localCount}`);
  console.log(`Max block size: ${statistics.maxBlockSize}`);
  console.log(`Avg block size: ${statistics.avgBlockSize.toFixed(2)}`);
  console.log(`CFG edges: ${statistics.cfgEdges}`);
  console.log("\nInstruction types:");
  for (const [type, count] of Object.entries(statistics.instructionTypes)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log("");
}

async function showBothVersions(
  source: string,
  optimizationLevel: number,
  format: string,
  sourcePath: string,
): Promise<void> {
  // First compile without optimization
  const unoptResult = await compile({
    to: "ir",
    optimizer: {
      level: 0,
    },
    source,
    sourcePath,
  });

  if (unoptResult.success) {
    const unoptIr = unoptResult.value.ir;
    console.log("=== Unoptimized IR ===");
    if (format === "json") {
      console.log(JSON.stringify(unoptIr, null, 2));
    } else {
      const formatter = new IrFormatter();
      console.log(formatter.format(unoptIr));
    }
    console.log("\n=== Optimized IR (Level " + optimizationLevel + ") ===");
  }
}
