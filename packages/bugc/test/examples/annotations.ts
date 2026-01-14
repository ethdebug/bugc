/**
 * Test Block Parser
 *
 * Parses fenced YAML test blocks from .bug source files.
 * Format: multi-line comment starting with @test, containing YAML.
 */

import YAML from "yaml";

export interface VariableExpectation {
  pointer?: unknown;  // Expected pointer structure
  value?: string | number | bigint;  // Expected dereferenced value
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
 * Parse all test blocks from a source file.
 */
export function parseTestBlocks(source: string): TestBlock[] {
  const blocks: TestBlock[] = [];

  // Match /*@test <name>\n<yaml>\n*/
  const regex = /\/\*@test\s*(\S*)?\n([\s\S]*?)\*\//g;

  let match;
  while ((match = regex.exec(source)) !== null) {
    const name = match[1] || undefined;
    const yamlContent = match[2].trim();

    try {
      const parsed = YAML.parse(yamlContent);

      // Must have at-line and variables
      if (!isValidTest(parsed)) {
        continue;
      }

      const expectFail = extractExpectFail(parsed);

      blocks.push({
        name,
        raw: yamlContent,
        parsed: normalizeTest(parsed),
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
  return "at-line" in obj && "variables" in obj;
}

function extractExpectFail(parsed: Record<string, unknown>): string | undefined {
  if ("fails" in parsed) {
    return typeof parsed.fails === "string" ? parsed.fails : "expected failure";
  }
  return undefined;
}

function normalizeTest(parsed: Record<string, unknown>): VariablesTest {
  return {
    atLine: parsed["at-line"] as number,
    after: parsed.after as "deploy" | "call" | undefined,
    callData: parsed["call-data"] as string | undefined,
    variables: parsed.variables as Record<string, VariableExpectation>,
  };
}
