/**
 * EVM Bytecode Generator with strongly-typed state management
 */

import type * as Ir from "../ir";
import type { GenState } from "./operations/state";
import { operations } from "./operations/operations";
import { emitPush } from "./operations/push";
import { serialize, calculateSize } from "./serialize";
import type { MemoryInfo } from "./analysis/memory";
import type { BlockInfo } from "./analysis/layout";
import { generateFunction } from "./ir-handlers";
import type { EvmError } from "./errors";
import type { Instruction } from "../evm";

/**
 * Generate bytecode for entire module
 */
export function generateModule(
  module: Ir.IrModule,
  memory: MemoryInfo,
  blocks: BlockInfo,
): {
  create?: number[];
  runtime: number[];
  createInstructions?: Instruction[];
  runtimeInstructions: Instruction[];
  warnings: EvmError[];
} {
  // Generate runtime function
  const runtimeResult = generateFunction(module.main, memory.main, blocks.main);

  // Collect all warnings
  let allWarnings: EvmError[] = [...runtimeResult.warnings];

  // Generate constructor function if present
  let createBytes: number[] = [];
  let allCreateInstructions: Instruction[] = [];
  if (module.create && memory.create && blocks.create) {
    const createResult = generateFunction(
      module.create,
      memory.create,
      blocks.create,
    );
    createBytes = createResult.bytecode;
    allCreateInstructions = [...createResult.instructions];
    allWarnings = [...allWarnings, ...createResult.warnings];
  }

  // Build complete deployment bytecode and get deployment wrapper instructions
  const { deployBytes, deploymentWrapperInstructions } =
    buildDeploymentInstructions(createBytes, runtimeResult.bytecode);

  // Combine constructor instructions with deployment wrapper
  const finalCreateInstructions =
    allCreateInstructions.length > 0 || deploymentWrapperInstructions.length > 0
      ? [...allCreateInstructions, ...deploymentWrapperInstructions]
      : undefined;

  return {
    create: deployBytes,
    runtime: runtimeResult.bytecode,
    createInstructions: finalCreateInstructions,
    runtimeInstructions: runtimeResult.instructions,
    warnings: allWarnings,
  };
}

/**
 * Calculate the size of deployment bytecode with proper PUSH sizing
 */
function calculateDeploymentSize(
  createBytesLength: number,
  runtimeBytesLength: number,
): number {
  // Initial state just for calculating push sizes
  const state: GenState<[]> = {
    brands: [],
    stack: [],
    instructions: [],
    memory: { allocations: {}, freePointer: 0x80 },
    nextId: 0,
    patches: [],
    blockOffsets: {},
    warnings: [],
  };

  let deploymentPrefixSize = 0;
  let lastSize = -1;

  // Iterate until size stabilizes
  while (deploymentPrefixSize !== lastSize) {
    lastSize = deploymentPrefixSize;

    // Calculate size based on current estimate
    const runtimeOffset = BigInt(createBytesLength + deploymentPrefixSize);
    const runtimeLength = BigInt(runtimeBytesLength);

    // Build deployment wrapper instructions
    const testState = state;
    const s1 = emitPush(testState, runtimeLength, { brand: "size" });
    const s2 = emitPush(s1, runtimeOffset, { brand: "offset" });
    const s3 = emitPush(s2, 0n, { brand: "destOffset" });
    const s4 = operations.CODECOPY(s3);
    const s5 = emitPush(s4, runtimeLength, { brand: "size" });
    const s6 = emitPush(s5, 0n, { brand: "offset" });
    const s7 = operations.RETURN(s6);

    deploymentPrefixSize = calculateSize(s7.instructions);
  }

  return createBytesLength + deploymentPrefixSize;
}

/**
 * Build deployment bytecode and instructions (constructor + runtime deployment wrapper)
 */
function buildDeploymentInstructions(
  createBytes: number[],
  runtimeBytes: number[],
): { deployBytes: number[]; deploymentWrapperInstructions: Instruction[] } {
  const state: GenState<[]> = {
    brands: [],
    stack: [],
    instructions: [],
    memory: { allocations: {}, freePointer: 0x80 },
    nextId: 0,
    patches: [],
    blockOffsets: {},
    warnings: [],
  };

  const deploymentSize = calculateDeploymentSize(
    createBytes.length,
    runtimeBytes.length,
  );
  const runtimeOffset = BigInt(deploymentSize);
  const runtimeLength = BigInt(runtimeBytes.length);

  // Build deployment wrapper
  const s1 = emitPush(state, runtimeLength, { brand: "size" });
  const s2 = emitPush(s1, runtimeOffset, { brand: "offset" });
  const s3 = emitPush(s2, 0n, { brand: "destOffset" });
  const s4 = operations.CODECOPY(s3);
  const s5 = emitPush(s4, runtimeLength, { brand: "size" });
  const s6 = emitPush(s5, 0n, { brand: "offset" });
  const s7 = operations.RETURN(s6);

  const deploymentWrapperBytes = serialize(s7.instructions);

  // Combine everything
  const deployBytes = [
    ...createBytes,
    ...deploymentWrapperBytes,
    ...runtimeBytes,
  ];

  return {
    deployBytes,
    deploymentWrapperInstructions: s7.instructions,
  };
}
