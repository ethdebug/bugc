/**
 * Test Block Parser
 *
 * Parses fenced YAML test blocks from .bug source files.
 * Format: multi-line comment starting with @test, containing YAML.
 */

import YAML from "yaml";

// Slot can be a literal number/string or a pointer expression
export type SlotExpression = string | number | Record<string, unknown>;

export interface StorageExpectation {
  slot: SlotExpression;
  value: string | number;
}

export interface StorageTest {
  after: "deploy" | "call";
  callData?: string;
  // Simple format: { "0": 42 } or array format: [{ slot: expr, value: 42 }]
  storage: StorageExpectation[];
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
  const rawStorage = parsed.storage;
  let storage: StorageExpectation[];

  if (Array.isArray(rawStorage)) {
    // Array format: [{ slot: expr, value: 42 }]
    storage = rawStorage.map((item: { slot: SlotExpression; value: unknown }) =>
      ({
        slot: item.slot,
        value: item.value as string | number,
      })
    );
  } else if (typeof rawStorage === "object" && rawStorage !== null) {
    // Simple format: { "0": 42, "1": 100 }
    storage = Object.entries(rawStorage as Record<string, unknown>).map(
      ([slot, value]) => ({
        slot: slot,
        value: value as string | number,
      })
    );
  } else {
    storage = [];
  }

  return {
    after: parsed.after as "deploy" | "call",
    callData: parsed["call-data"] as string | undefined,
    storage,
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
