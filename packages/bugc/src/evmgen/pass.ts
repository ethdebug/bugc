import { Result } from "../result";
import type { Pass } from "../compiler/pass";
import type { IrModule } from "../ir";
import { generateModule } from "./generator";
import { EvmError, EvmErrorCode } from "./errors";
import type { Instruction } from "../evm";
import { analyzeModuleLiveness } from "./analysis/liveness";
import { analyzeModuleMemory } from "./analysis/memory";
import { analyzeModuleBlockLayout } from "./analysis/layout";

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
  };
  adds: {
    bytecode: EvmGenerationOutput;
  };
  error: EvmError;
}> = {
  async run({ ir }) {
    try {
      // Analyze liveness
      const liveness = analyzeModuleLiveness(ir);
      
      // Analyze memory requirements
      const memoryResult = analyzeModuleMemory(ir, liveness);
      if (!memoryResult.success) {
        return Result.err(new EvmError(EvmErrorCode.INTERNAL_ERROR, memoryResult.messages.error?.[0]?.message ?? "Memory analysis failed"));
      }

      // Analyze block layout
      const blockResult = analyzeModuleBlockLayout(ir);
      if (!blockResult.success) {
        return Result.err(new EvmError(EvmErrorCode.INTERNAL_ERROR, blockResult.messages.error?.[0]?.message ?? "Block layout analysis failed"));
      }

      // Generate bytecode
      const result = generateModule(ir, memoryResult.value, blockResult.value);

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
