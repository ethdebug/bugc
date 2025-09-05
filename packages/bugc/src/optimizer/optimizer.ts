import { IrModule, IrInstruction, IrFunction, BasicBlock } from "../ir";
import { SourceLocation } from "../ast";

export interface OptimizationStep {
  name: string;
  run(module: IrModule, context: OptimizationContext): IrModule;
}

export interface OptimizationContext {
  trackTransformation(transform: SourceTransform): void;
  getTransformations(): SourceTransform[];

  // For passes that need to share analysis results
  getAnalysis<T>(key: string): T | undefined;
  setAnalysis<T>(key: string, value: T): void;
}

export type TransformationType =
  | "move"
  | "merge"
  | "delete"
  | "split"
  | "replace";

export interface SourceTransform {
  type: TransformationType;
  pass: string;
  original: SourceLocation[];
  result: SourceLocation[];
  reason: string;
}

export interface OptimizationStats {
  passName: string;
  instructionsRemoved: number;
  instructionsAdded: number;
  blocksRemoved: number;
  blocksAdded: number;
  transformations: number;
}

export interface OptimizationResult {
  module: IrModule;
  stats: OptimizationStats[];
  transformations: SourceTransform[];
}

export class OptimizationContextImpl implements OptimizationContext {
  private transformations: SourceTransform[] = [];
  private analysisCache = new Map<string, unknown>();

  trackTransformation(transform: SourceTransform): void {
    this.transformations.push(transform);
  }

  getTransformations(): SourceTransform[] {
    return this.transformations;
  }

  getAnalysis<T>(key: string): T | undefined {
    return this.analysisCache.get(key) as T | undefined;
  }

  setAnalysis<T>(key: string, value: T): void {
    this.analysisCache.set(key, value);
  }
}

export class OptimizationPipeline {
  constructor(private steps: OptimizationStep[]) {}

  optimize(module: IrModule): OptimizationResult {
    const context = new OptimizationContextImpl();
    const stats: OptimizationStats[] = [];

    let currentModule = module;

    for (const step of this.steps) {
      const startInstructions = this.countInstructions(currentModule);
      const startBlocks = this.countBlocks(currentModule);
      const startTransforms = context.getTransformations().length;

      currentModule = step.run(currentModule, context);

      const endInstructions = this.countInstructions(currentModule);
      const endBlocks = this.countBlocks(currentModule);
      const endTransforms = context.getTransformations().length;

      stats.push({
        passName: step.name,
        instructionsRemoved: Math.max(0, startInstructions - endInstructions),
        instructionsAdded: Math.max(0, endInstructions - startInstructions),
        blocksRemoved: Math.max(0, startBlocks - endBlocks),
        blocksAdded: Math.max(0, endBlocks - startBlocks),
        transformations: endTransforms - startTransforms,
      });
    }

    return {
      module: currentModule,
      stats,
      transformations: context.getTransformations(),
    };
  }

  private countInstructions(module: IrModule): number {
    let count = 0;

    // Count main function instructions
    for (const block of module.main.blocks.values()) {
      count += block.instructions.length;
      count += 1; // terminator
    }

    // Count create function instructions if present
    if (module.create) {
      for (const block of module.create.blocks.values()) {
        count += block.instructions.length;
        count += 1; // terminator
      }
    }

    // Count user-defined function instructions
    if (module.functions) {
      for (const func of module.functions.values()) {
        for (const block of func.blocks.values()) {
          count += block.instructions.length;
          count += 1; // terminator
        }
      }
    }

    return count;
  }

  private countBlocks(module: IrModule): number {
    let count = module.main.blocks.size;

    if (module.create) {
      count += module.create.blocks.size;
    }

    // Count user-defined function blocks
    if (module.functions) {
      for (const func of module.functions.values()) {
        count += func.blocks.size;
      }
    }

    return count;
  }
}

// Base class for optimization passes
export abstract class BaseOptimizationStep implements OptimizationStep {
  abstract name: string;

  abstract run(module: IrModule, context: OptimizationContext): IrModule;

  /**
   * Apply optimization to all functions (main, create, and user-defined)
   */
  protected processAllFunctions(
    module: IrModule,
    processor: (func: IrFunction, funcName: string) => void,
  ): void {
    // Process main function
    processor(module.main, "main");

    // Process create function if present
    if (module.create) {
      processor(module.create, "create");
    }

    // Process user-defined functions
    if (module.functions) {
      for (const [name, func] of module.functions.entries()) {
        processor(func, name);
      }
    }
  }

  protected cloneModule(module: IrModule): IrModule {
    // Clone main function
    const clonedMain = this.cloneFunction(module.main);

    // Clone create function if present
    let clonedCreate: IrFunction | undefined;
    if (module.create) {
      clonedCreate = this.cloneFunction(module.create);
    }

    // Clone user-defined functions
    const clonedFunctions = new Map<string, IrFunction>();
    if (module.functions) {
      for (const [name, func] of module.functions.entries()) {
        clonedFunctions.set(name, this.cloneFunction(func));
      }
    }

    return {
      name: module.name,
      storage: {
        slots: [...module.storage.slots],
      },
      functions: clonedFunctions,
      create: clonedCreate,
      main: clonedMain,
      loc: module.loc,
    };
  }

  protected cloneFunction(func: IrFunction): IrFunction {
    // Deep clone that preserves Map structure
    const clonedBlocks = new Map<string, BasicBlock>();

    for (const [id, block] of func.blocks.entries()) {
      clonedBlocks.set(id, {
        id: block.id,
        phis: block.phis ? [...block.phis] : [],
        instructions: [...block.instructions],
        terminator: { ...block.terminator },
        predecessors: new Set(block.predecessors),
        loc: block.loc,
      });
    }

    return {
      name: func.name,
      locals: [...func.locals],
      paramCount: func.paramCount,
      entry: func.entry,
      blocks: clonedBlocks,
    };
  }

  protected replaceInstruction(
    instructions: IrInstruction[],
    index: number,
    newInstruction: IrInstruction | null,
    context: OptimizationContext,
    reason: string,
  ): IrInstruction[] {
    const result = [...instructions];
    const original = instructions[index];

    if (newInstruction === null) {
      // Delete instruction
      result.splice(index, 1);
      context.trackTransformation({
        type: "delete",
        pass: this.name,
        original: original.loc ? [original.loc] : [],
        result: [],
        reason,
      });
    } else {
      // Replace instruction
      result[index] = newInstruction;
      context.trackTransformation({
        type: "replace",
        pass: this.name,
        original: original.loc ? [original.loc] : [],
        result: newInstruction.loc ? [newInstruction.loc] : [],
        reason,
      });
    }

    return result;
  }
}
