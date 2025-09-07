import { Result } from "#result";
import type { Pass } from "#compiler";
import type * as Ir from "#ir";
import type * as Evm from "#evm";

import { Module } from "#evmgen/generation";
import { Error, ErrorCode } from "#evmgen/errors";

import { Layout, Liveness, Memory } from "#evmgen/analysis";

/**
 * Output produced by the EVM generation pass
 */
export interface EvmGenerationOutput {
  /** Runtime bytecode */
  runtime: Uint8Array;
  /** Constructor bytecode (optional) */
  create?: Uint8Array;
  /** Runtime instructions */
  runtimeInstructions: Evm.Instruction[];
  /** Constructor instructions (optional) */
  createInstructions?: Evm.Instruction[];
}

/**
 * EVM code generation pass
 */
export const pass: Pass<{
  needs: {
    ir: Ir.Module;
  };
  adds: {
    bytecode: EvmGenerationOutput;
  };
  error: Error;
}> = {
  async run({ ir }) {
    try {
      // Analyze liveness
      const liveness = Liveness.Module.analyze(ir);

      // Analyze memory requirements
      const memoryResult = Memory.Module.plan(ir, liveness);
      if (!memoryResult.success) {
        return Result.err(
          new Error(
            ErrorCode.INTERNAL_ERROR,
            memoryResult.messages.error?.[0]?.message ??
              "Memory analysis failed",
          ),
        );
      }

      // Analyze block layout
      const blockResult = Layout.Module.perform(ir);
      if (!blockResult.success) {
        return Result.err(
          new Error(
            ErrorCode.INTERNAL_ERROR,
            blockResult.messages.error?.[0]?.message ??
              "Block layout analysis failed",
          ),
        );
      }

      // Generate bytecode
      const result = Module.generate(ir, memoryResult.value, blockResult.value);

      // Convert to Uint8Array
      const runtime = new Uint8Array(result.runtime);
      const create = result.create ? new Uint8Array(result.create) : undefined;

      return Result.okWith(
        {
          bytecode: {
            runtime,
            create,
            runtimeInstructions: result.runtimeInstructions,
            createInstructions: result.createInstructions,
          },
        },
        { warning: result.warnings },
      );
    } catch (error) {
      if (error instanceof Error) {
        return Result.err(error);
      }

      // Wrap unexpected errors
      return Result.err(
        new Error(
          ErrorCode.INTERNAL_ERROR,
          error instanceof global.Error ? error.message : String(error),
        ),
      );
    }
  },
};
