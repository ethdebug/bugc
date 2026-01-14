/**
 * Test Runners
 *
 * Execute storage, variables, and evaluate tests against compiled bytecode.
 */

import type * as Evm from "#evm";
import * as Format from "@ethdebug/format";
import { dereference } from "@ethdebug/pointers";
import { bytesToHex } from "ethereum-cryptography/utils";

import { EvmExecutor } from "../evm/index.js";
import type { StorageTest, VariablesTest, EvaluateTest } from "./annotations.js";
import type { SourceMapping } from "./source-map.js";
import { findInstructionsAtLine } from "./source-map.js";
import { createMachineState } from "./machine-adapter.js";

export interface TestResult {
  passed: boolean;
  message?: string;
  expected?: unknown;
  actual?: unknown;
}

/**
 * Convert Uint8Array to hex string (without 0x prefix).
 */
function toHex(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}

/**
 * Run a storage test: deploy bytecode and check storage slot values.
 */
export async function runStorageTest(
  bytecode: { runtime: Uint8Array; create?: Uint8Array },
  test: StorageTest
): Promise<TestResult> {
  const executor = new EvmExecutor();

  try {
    if (test.after === "deploy") {
      // Use create bytecode if available, otherwise runtime
      const hasCreate = bytecode.create && bytecode.create.length > 0;
      const createCode = hasCreate
        ? toHex(bytecode.create!)
        : toHex(bytecode.runtime);
      await executor.deploy(createCode);
    }

    if (test.after === "call") {
      // Deploy first, then call
      const createCode = bytecode.create
        ? toHex(bytecode.create)
        : toHex(bytecode.runtime);
      await executor.deploy(createCode);
      const execResult = await executor.execute({ data: test.callData || "" });
      if (!execResult.success) {
        return {
          passed: false,
          message: `Execution failed: ${JSON.stringify(execResult.error)}`,
        };
      }
    }

    // Check each expected storage slot
    for (const [slot, expected] of Object.entries(test.storage)) {
      const slotNum = BigInt(slot);
      const actual = await executor.getStorage(slotNum);
      const expectedNum = BigInt(expected);

      if (actual !== expectedNum) {
        return {
          passed: false,
          message: `Storage slot ${slot}: expected ${expectedNum}, got ${actual}`,
          expected: expectedNum,
          actual,
        };
      }
    }

    return { passed: true };
  } catch (error) {
    return {
      passed: false,
      message: `Execution error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Run a variables test: check debug info pointer structure at a source line.
 */
export function runVariablesTest(
  instructions: Evm.Instruction[],
  sourceMapping: SourceMapping,
  test: VariablesTest
): TestResult {
  const instrIndices = findInstructionsAtLine(sourceMapping, test.atLine);

  if (instrIndices.length === 0) {
    return {
      passed: false,
      message: `No instructions found at line ${test.atLine}`,
    };
  }

  // Collect variables from all instructions at this line
  const variables = new Map<string, Format.Pointer>();

  for (const idx of instrIndices) {
    const instr = instructions[idx];
    const context = instr.debug?.context;

    if (!context) {
      continue;
    }

    // Extract variables from context
    const vars = extractVariables(context);
    for (const v of vars) {
      if (v.identifier && v.pointer) {
        variables.set(v.identifier, v.pointer);
      }
    }
  }

  // Compare against expected
  for (const [name, expected] of Object.entries(test.variables)) {
    const actual = variables.get(name);

    if (!actual) {
      return {
        passed: false,
        message: `Variable "${name}" not found at line ${test.atLine}`,
      };
    }

    if (expected.pointer) {
      const match = deepEqual(actual, expected.pointer);
      if (!match) {
        return {
          passed: false,
          message: `Variable "${name}" pointer mismatch`,
          expected: expected.pointer,
          actual,
        };
      }
    }
  }

  return { passed: true };
}

/**
 * Run an evaluate test: dereference pointers and compare actual values.
 */
export async function runEvaluateTest(
  instructions: Evm.Instruction[],
  sourceMapping: SourceMapping,
  executor: EvmExecutor,
  test: EvaluateTest
): Promise<TestResult> {
  const instrIndices = findInstructionsAtLine(sourceMapping, test.atLine);

  if (instrIndices.length === 0) {
    return {
      passed: false,
      message: `No instructions found at line ${test.atLine}`,
    };
  }

  // Get machine state from executor
  const state = createMachineState(executor);

  // Collect variables and their pointers
  const variables = new Map<string, Format.Pointer>();

  for (const idx of instrIndices) {
    const instr = instructions[idx];
    const context = instr.debug?.context;

    if (!context) {
      continue;
    }

    const vars = extractVariables(context);
    for (const v of vars) {
      if (v.identifier && v.pointer) {
        variables.set(v.identifier, v.pointer);
      }
    }
  }

  // Evaluate each variable's pointer and compare value
  for (const [name, expectedSpec] of Object.entries(test.variables)) {
    const pointer = variables.get(name);

    if (!pointer) {
      return {
        passed: false,
        message: `Variable "${name}" not found at line ${test.atLine}`,
      };
    }

    try {
      // Dereference the pointer
      const cursor = await dereference(pointer, { state });
      const view = await cursor.view(state);

      // Read the value from the first region
      if (view.regions.length === 0) {
        return {
          passed: false,
          message: `No regions for pointer of variable "${name}"`,
        };
      }

      const data = await view.read(view.regions[0]);
      const actual = data.asUint();
      const expected = BigInt(expectedSpec.value);

      if (actual !== expected) {
        return {
          passed: false,
          message: `Variable "${name}": expected ${expected}, got ${actual}`,
          expected,
          actual,
        };
      }
    } catch (error) {
      return {
        passed: false,
        message: `Failed to evaluate pointer for "${name}": ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return { passed: true };
}

/**
 * Extract variables from a context (handles gather/pick/variables variants).
 */
function extractVariables(
  context: Format.Program.Context
): Format.Program.Context.Variables.Variable[] {
  const result: Format.Program.Context.Variables.Variable[] = [];

  // Direct variables context
  if (Format.Program.Context.isVariables(context)) {
    result.push(...context.variables);
  }

  // Gather context - collect from children
  if (Format.Program.Context.isGather(context)) {
    for (const child of context.gather) {
      result.push(...extractVariables(child));
    }
  }

  // Pick context - collect from all options
  if (Format.Program.Context.isPick(context)) {
    for (const option of context.pick) {
      result.push(...extractVariables(option));
    }
  }

  return result;
}

/**
 * Deep equality check for pointer structures.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a !== typeof b) {
    return false;
  }

  if (typeof a !== "object" || a === null || b === null) {
    return false;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;

  return aKeys.every(key => deepEqual(aObj[key], bObj[key]));
}
