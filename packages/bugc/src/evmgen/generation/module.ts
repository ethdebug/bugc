/**
 * EVM Bytecode Generator with strongly-typed state management
 */

import type * as Ir from "#ir";
import type * as Evm from "#evm";

import type { State } from "#evmgen/state";
import { pipe, operations } from "#evmgen/operations";
import { Memory, Layout } from "#evmgen/analysis";
import { serialize, calculateSize } from "#evmgen/serialize";
import type { Error } from "#evmgen/errors";

import * as Function from "./function.js";

/**
 * Generate bytecode for entire module
 */
export function generate(
  module: Ir.IrModule,
  memory: Memory.Module.Info,
  blocks: Layout.Module.Info,
): {
  create?: number[];
  runtime: number[];
  createInstructions?: Evm.Instruction[];
  runtimeInstructions: Evm.Instruction[];
  warnings: Error[];
} {
  // Generate runtime function
  const runtimeResult = Function.generate(
    module.main,
    memory.main,
    blocks.main,
  );

  // Collect all warnings
  let allWarnings: Error[] = [...runtimeResult.warnings];

  // Generate constructor function if present
  let createBytes: number[] = [];
  let allCreateInstructions: Evm.Instruction[] = [];
  if (module.create && memory.create && blocks.create) {
    const createResult = Function.generate(
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
  const state: State<[]> = {
    brands: [],
    stack: [],
    instructions: [],
    memory: { allocations: {}, nextStaticOffset: 0x80 },
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
): { deployBytes: number[]; deploymentWrapperInstructions: Evm.Instruction[] } {
  const state: State<[]> = {
    brands: [],
    stack: [],
    instructions: [],
    memory: { allocations: {}, nextStaticOffset: 0x80 },
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
