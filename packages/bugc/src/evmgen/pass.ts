import { Result } from "../result";
import type { Pass } from "../compiler/pass";
import type { IrModule } from "../ir";
import type { MemoryInfo } from "../memory/memory-planner";
import type { BlockInfo } from "../memory/block-layout";
import { generateModule } from "./generator";
import { EvmError, EvmErrorCode } from "./errors";
import type { Instruction } from "../evm/operations";

/**
 * Output produced by the EVM generation pass
 */
export interface EvmGenerationOutput {
  /** Runtime bytecode */
  runtime: Uint8Array;
  /** Constructor bytecode (optional) */
  create?: Uint8Array;
  /** Runtime instructions */
  runtimeInstructions: Instruction[];
  /** Constructor instructions (optional) */
  createInstructions?: Instruction[];
}

/**
 * EVM code generation pass
 */
export const pass: Pass<{
  needs: {
    ir: IrModule;
    memory: MemoryInfo;
    blocks: BlockInfo;
  };
  adds: {
    bytecode: EvmGenerationOutput;
  };
  error: EvmError;
}> = {
  async run({ ir, memory, blocks }) {
    try {
      // Generate bytecode
      const result = generateModule(ir, memory, blocks);

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
      if (error instanceof EvmError) {
        return Result.err(error);
      }

      // Wrap unexpected errors
      return Result.err(
        new EvmError(
          EvmErrorCode.INTERNAL_ERROR,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
};
