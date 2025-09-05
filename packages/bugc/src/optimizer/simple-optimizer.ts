/**
 * Simplified optimizer implementation that uses the optimization step architecture
 */

import { IrModule } from "#ir";
import { OptimizationPipeline, OptimizationStep } from "./optimizer.js";
import {
  ConstantFoldingStep,
  DeadCodeEliminationStep,
  CommonSubexpressionEliminationStep,
  ConstantPropagationStep,
  JumpOptimizationStep,
  BlockMergingStep,
  ReturnMergingStep,
} from "./steps/index.js";

/**
 * Apply all optimizations based on the specified level
 */
export function optimizeIr(module: IrModule, level: number): IrModule {
  if (level === 0) return module;

  const steps = createOptimizationPipeline(level);
  const pipeline = new OptimizationPipeline(steps);

  let current = module;
  let previousHash = "";

  // Run optimization steps until fixpoint for level 2+
  do {
    const currentHash = JSON.stringify(current);
    if (currentHash === previousHash) break; // Reached fixpoint
    previousHash = currentHash;

    const result = pipeline.optimize(current);
    current = result.module;
  } while (level >= 2);

  return current;
}

/**
 * Create optimization pipeline for a given level
 */
function createOptimizationPipeline(level: number): OptimizationStep[] {
  const steps: OptimizationStep[] = [];

  if (level === 0) return steps;

  // Level 1: Basic optimizations
  if (level >= 1) {
    steps.push(
      new ConstantFoldingStep(),
      new ConstantPropagationStep(),
      new DeadCodeEliminationStep(),
    );
  }

  // Level 2: Add CSE and jump optimization
  if (level >= 2) {
    steps.push(
      new CommonSubexpressionEliminationStep(),
      new JumpOptimizationStep(),
    );
  }

  // Level 3: Add block merging
  if (level >= 3) {
    steps.push(new BlockMergingStep(), new ReturnMergingStep());
  }

  return steps;
}
