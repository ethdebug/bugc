/**
 * Test Block Parser
 *
 * Parses fenced YAML test blocks from .bug source files.
 * Format: multi-line comment starting with @test, containing YAML.
 */

import YAML from "yaml";

export interface VariableExpectation {
  pointer?: unknown;  // Expected pointer structure
  value?: string | number | bigint;  // Expected dereferenced scalar value
  values?: (string | number | bigint)[];  // Expected values for each region
  type?: unknown;  // Expected type (future use)
}

export interface VariablesTest {
  atLine: number;
  after?: "deploy" | "call";  // When to check values (default: deploy)
  callData?: string;  // Call data if after: call
  variables: Record<string, VariableExpectation>;
}

export interface TestBlock {
  name?: string;
  raw: string;
  parsed: VariablesTest;
  expectFail?: string;  // If set, test is expected to fail with this reason
}

/**
 * Find the last non-empty, non-comment line before a given offset.
 * This is used for "at: here" to find the code line above the test block.
 */
function findPrecedingCodeLine(source: string, offset: number): number {
  // Get all text up to the offset
  const textBefore = source.slice(0, offset);

  // Remove all multi-line comments (including nested test blocks)
  // Replace with equivalent newlines to preserve line numbers
  const withoutBlockComments = textBefore.replace(
    /\/\*[\s\S]*?\*\//g,
    (match) => match.replace(/[^\n]/g, " ")
  );

  const lines = withoutBlockComments.split("\n");

  // Walk backwards to find the last line with actual code
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    // Skip empty lines and single-line comments
    if (line && !line.startsWith("//")) {
      return i + 1; // 1-indexed line numbers
    }
  }

  // Fallback to the line before the block
  return Math.max(1, lines.length);
}

/**
 * Remove common leading indentation from a multi-line string.
 */
function dedent(text: string): string {
  const lines = text.split("\n");

  // Find minimum indentation (ignoring empty lines)
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim()) {
      const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
      minIndent = Math.min(minIndent, indent);
    }
  }

  if (minIndent === Infinity || minIndent === 0) {
    return text;
  }

  // Remove the common indentation
  return lines.map((line) => line.slice(minIndent)).join("\n");
}

/**
 * Parse all test blocks from a source file.
 */
export function parseTestBlocks(source: string): TestBlock[] {
  const blocks: TestBlock[] = [];

  // Match /*@test <name>\n<yaml>\n*/
  const regex = /\/\*@test\s*(\S*)?\n([\s\S]*?)\*\//g;

  let match;
  while ((match = regex.exec(source)) !== null) {
    const name = match[1] || undefined;
    const yamlContent = dedent(match[2]).trim();
    const blockStartOffset = match.index;

    try {
      const parsed = YAML.parse(yamlContent);

      // Must have (at-line or at: here) and variables
      if (!isValidTest(parsed)) {
        continue;
      }

      const expectFail = extractExpectFail(parsed);

      blocks.push({
        name,
        raw: yamlContent,
        parsed: normalizeTest(parsed, source, blockStartOffset),
        expectFail,
      });
    } catch {
      // Skip malformed test blocks
    }
  }

  return blocks;
}

function isValidTest(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) {
    return false;
  }
  const obj = parsed as Record<string, unknown>;
  const hasLocation = "at-line" in obj || obj.at === "here";
  return hasLocation && "variables" in obj;
}

function extractExpectFail(parsed: Record<string, unknown>): string | undefined {
  if ("fails" in parsed) {
    return typeof parsed.fails === "string" ? parsed.fails : "expected failure";
  }
  return undefined;
}

function normalizeTest(
  parsed: Record<string, unknown>,
  source: string,
  blockOffset: number
): VariablesTest {
  // Support both "at-line: N" and "at: here"
  // "at: here" means the code line immediately before the test block
  const atLine = parsed.at === "here"
    ? findPrecedingCodeLine(source, blockOffset)
    : (parsed["at-line"] as number);

  return {
    atLine,
    after: parsed.after as "deploy" | "call" | undefined,
    callData: parsed["call-data"] as string | undefined,
    variables: parsed.variables as Record<string, VariableExpectation>,
  };
}
