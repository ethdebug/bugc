/**
 * Example Files Test Suite
 *
 * Automatically discovers and tests all .bug example files.
 * Supports annotations for test behavior:
 *   // @wip                    - Skip test (work in progress)
 *   // @skip Reason            - Skip with reason
 *   // @expect-parse-error     - Expected to fail parsing
 *   // @expect-typecheck-error - Expected to fail typechecking
 *   // @expect-ir-error        - Expected to fail IR generation
 *   // @expect-bytecode-error  - Expected to fail bytecode generation
 */

import { describe, it, expect } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import { bytecodeSequence, buildSequence } from "#compiler";
import { Result } from "#result";

const EXAMPLES_DIR = path.resolve(__dirname, "../../examples");

interface ExampleInfo {
  relativePath: string;
  fullPath: string;
  source: string;
  annotations: {
    wip: boolean;
    skip: string | false;
    expectParseError: boolean;
    expectTypecheckError: boolean;
    expectIrError: boolean;
    expectBytecodeError: boolean;
  };
}

function parseAnnotations(source: string): ExampleInfo["annotations"] {
  return {
    wip: source.includes("// @wip"),
    skip: source.match(/\/\/ @skip\s*(.*)/)?.[1] || false,
    expectParseError: source.includes("// @expect-parse-error"),
    expectTypecheckError: source.includes("// @expect-typecheck-error"),
    expectIrError: source.includes("// @expect-ir-error"),
    expectBytecodeError: source.includes("// @expect-bytecode-error"),
  };
}

async function loadExamples(): Promise<ExampleInfo[]> {
  const files = await glob("**/*.bug", { cwd: EXAMPLES_DIR });
  const examples: ExampleInfo[] = [];

  for (const relativePath of files.sort()) {
    const fullPath = path.join(EXAMPLES_DIR, relativePath);
    const source = await fs.readFile(fullPath, "utf-8");

    examples.push({
      relativePath,
      fullPath,
      source,
      annotations: parseAnnotations(source),
    });
  }

  return examples;
}

describe("Example Files", async () => {
  const examples = await loadExamples();

  for (const example of examples) {
    const { relativePath, source, annotations } = example;

    // Determine describe function based on annotations
    const describeFn =
      annotations.wip || annotations.skip ? describe.skip : describe;

    const skipReason = annotations.skip
      ? ` (skip: ${annotations.skip})`
      : annotations.wip
        ? " (wip)"
        : "";

    describeFn(`${relativePath}${skipReason}`, () => {
      it("compiles successfully", async () => {
        const compiler = buildSequence(bytecodeSequence);
        const result = await compiler.run({ source });

        // Check if we expected any errors
        const expectAnyError =
          annotations.expectParseError ||
          annotations.expectTypecheckError ||
          annotations.expectIrError ||
          annotations.expectBytecodeError;

        if (expectAnyError) {
          // We expected some error
          expect(result.success).toBe(false);
        } else {
          // We expected success
          if (!result.success) {
            // Provide helpful error message
            const errors = Result.errors(result);
            const errorMessages = errors
              .map(
                (e) => `${e.code || "ERROR"}: ${e.message || "Unknown error"}`
              )
              .join("\n");
            expect.fail(
              `Expected compilation to succeed but got errors:\n${errorMessages}`
            );
          }
          expect(result.success).toBe(true);
        }
      });

      // Future: add more tests here
      // it("compiles successfully with optimizations", async () => { ... });
      // it("executes correctly", async () => { ... });
    });
  }
});
