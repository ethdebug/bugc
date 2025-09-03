/**
 * EVM Bytecode Generator with strongly-typed state management
 */

import type * as Ir from "../ir";
import { type GenState, pipe, operations } from "./operations";
import { serialize, calculateSize } from "./serialize";
import type { MemoryInfo } from "./analysis/memory";
import type { BlockInfo } from "./analysis/layout";
import { generateFunction } from "./generation/function";
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
    const result = deploymentTransition(
      BigInt(createBytesLength + deploymentPrefixSize),
      BigInt(runtimeBytesLength),
    )(state);

    deploymentPrefixSize = calculateSize(result.instructions);
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
  const result = deploymentTransition(runtimeOffset, runtimeLength)(state);

  const deploymentWrapperBytes = serialize(result.instructions);

  // Combine everything
  const deployBytes = [
    ...createBytes,
    ...deploymentWrapperBytes,
    ...runtimeBytes,
  ];

  return {
    deployBytes,
    deploymentWrapperInstructions: result.instructions,
  };
}

function deploymentTransition(runtimeOffset: bigint, runtimeLength: bigint) {
  const { PUSHn, CODECOPY, RETURN } = operations;

  return pipe()
    .then(PUSHn(runtimeLength), { as: "size" })
    .then(PUSHn(runtimeOffset), { as: "offset" })
    .then(PUSHn(0n), { as: "destOffset" })
    .then(CODECOPY())
    .then(PUSHn(runtimeLength), { as: "size" })
    .then(PUSHn(0n), { as: "offset" })
    .then(RETURN())
    .done();
}
