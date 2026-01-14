/**
 * Test Block Parser
 *
 * Parses fenced YAML test blocks from .bug source files.
 * Format: multi-line comment starting with @test, containing YAML.
 */

import YAML from "yaml";

export interface StorageTest {
  after: "deploy" | "call";
  callData?: string;
  storage: Record<string, string | number>;
}

export interface VariablesTest {
  atLine: number;
  variables: Record<string, {
    pointer?: unknown;
    type?: unknown;
  }>;
}

export interface EvaluateTest {
  atLine: number;
  evaluate: true;
  variables: Record<string, {
    value: string | number | bigint;
  }>;
}

export type TestBlockType = "storage" | "variables" | "evaluate";

export interface TestBlock {
  name?: string;
  type: TestBlockType;
  raw: string;
  parsed: StorageTest | VariablesTest | EvaluateTest;
  expectFail?: string;  // If set, test is expected to fail with this reason
}

/**
 * Parse all test blocks from a source file.
 */
export function parseTestBlocks(source: string): TestBlock[] {
  const blocks: TestBlock[] = [];

  // Match /*@test <name>\n<yaml>\n*/
  // Note: using [\s\S] instead of . to match across lines
  const regex = /\/\*@test\s*(\S*)?\n([\s\S]*?)\*\//g;

  let match;
  while ((match = regex.exec(source)) !== null) {
    const name = match[1] || undefined;
    const yamlContent = match[2].trim();

    try {
      const parsed = YAML.parse(yamlContent);
      const type = determineTestType(parsed);
      const expectFail = extractExpectFail(parsed);

      if (type === "storage") {
        blocks.push({
          name,
          type,
          raw: yamlContent,
          parsed: normalizeStorageTest(parsed),
          expectFail,
        });
      } else if (type === "variables") {
        blocks.push({
          name,
          type,
          raw: yamlContent,
          parsed: normalizeVariablesTest(parsed),
          expectFail,
        });
      } else if (type === "evaluate") {
        blocks.push({
          name,
          type,
          raw: yamlContent,
          parsed: normalizeEvaluateTest(parsed),
          expectFail,
        });
      }
    } catch {
      // Skip malformed test blocks
    }
  }

  return blocks;
}

/**
 * Determine the type of test from parsed YAML content.
 */
function determineTestType(parsed: unknown): TestBlockType | null {
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  // Storage test: has "after" and "storage" keys
  if ("after" in obj && "storage" in obj) {
    return "storage";
  }

  // Evaluate test: has "evaluate: true" and "at-line"
  if ("evaluate" in obj && obj.evaluate === true && "at-line" in obj) {
    return "evaluate";
  }

  // Variables test: has "at-line" and "variables" keys
  if ("at-line" in obj && "variables" in obj) {
    return "variables";
  }

  return null;
}

/**
 * Extract expect-fail reason if present.
 */
function extractExpectFail(parsed: unknown): string | undefined {
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const obj = parsed as Record<string, unknown>;
  if ("fails" in obj) {
    return typeof obj.fails === "string" ? obj.fails : "expected failure";
  }
  return undefined;
}

function normalizeStorageTest(parsed: Record<string, unknown>): StorageTest {
  return {
    after: parsed.after as "deploy" | "call",
    callData: parsed["call-data"] as string | undefined,
    storage: parsed.storage as Record<string, string | number>,
  };
}

function normalizeVariablesTest(
  parsed: Record<string, unknown>
): VariablesTest {
  return {
    atLine: parsed["at-line"] as number,
    variables: parsed.variables as Record<string, {
      pointer?: unknown;
      type?: unknown;
    }>,
  };
}

function normalizeEvaluateTest(parsed: Record<string, unknown>): EvaluateTest {
  return {
    atLine: parsed["at-line"] as number,
    evaluate: true,
    variables: parsed.variables as Record<string, {
      value: string | number | bigint;
    }>,
  };
}
