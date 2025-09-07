import * as Ir from "#ir";
import {
  BaseOptimizationStep,
  type OptimizationContext,
} from "../optimizer.js";

export class DeadCodeEliminationStep extends BaseOptimizationStep {
  name = "dead-code-elimination";

  run(module: Ir.Module, context: OptimizationContext): Ir.Module {
    const optimized = this.cloneModule(module);

    // Process each function separately
    this.processAllFunctions(optimized, (func) => {
      // Collect all used values for this function
      const usedValues = new Set<string>();

      for (const block of func.blocks.values()) {
        // Analyze phi uses
        if (block.phis) {
          for (const phi of block.phis) {
            this.collectUsedValues(phi, usedValues);
          }
        }

        // Analyze instruction uses
        for (const inst of block.instructions) {
          this.collectUsedValues(inst, usedValues);
        }

        // Analyze terminator uses
        if (block.terminator.kind === "branch") {
          this.collectValueUse(block.terminator.condition, usedValues);
        } else if (
          block.terminator.kind === "return" &&
          block.terminator.value
        ) {
          this.collectValueUse(block.terminator.value, usedValues);
        }
      }

      // Remove dead instructions
      for (const block of func.blocks.values()) {
        // Remove dead phi nodes
        if (block.phis) {
          const newPhis = block.phis.filter((phi) => {
            if (!usedValues.has(phi.dest)) {
              context.trackTransformation({
                type: "delete",
                pass: this.name,
                original: phi.loc ? [phi.loc] : [],
                result: [],
                reason: `Removed unused phi node: ${phi.dest}`,
              });
              return false;
            }
            return true;
          });
          block.phis = newPhis;
        }

        // Remove dead instructions
        const newInstructions: Ir.Instruction[] = [];

        for (const inst of block.instructions) {
          if (this.hasSideEffects(inst)) {
            newInstructions.push(inst); // Keep instructions with side effects
          } else if (
            "dest" in inst &&
            inst.dest &&
            !usedValues.has(inst.dest)
          ) {
            // Dead instruction - track its removal
            context.trackTransformation({
              type: "delete",
              pass: this.name,
              original: inst.loc ? [inst.loc] : [],
              result: [],
              reason: `Removed unused instruction: ${inst.kind} -> ${inst.dest}`,
            });
          } else {
            newInstructions.push(inst);
          }
        }

        block.instructions = newInstructions;
      }
    });

    return optimized;
  }

  private collectUsedValues(
    inst: Ir.Block.Phi | Ir.Instruction,
    used: Set<string>,
  ): void {
    switch (inst.kind) {
      case "binary":
        this.collectValueUse(inst.left, used);
        this.collectValueUse(inst.right, used);
        break;
      case "unary":
        this.collectValueUse(inst.operand, used);
        break;
      case "store_storage":
        this.collectValueUse(inst.slot, used);
        this.collectValueUse(inst.value, used);
        break;
      case "load_storage":
        this.collectValueUse(inst.slot, used);
        break;
      case "store_mapping":
        this.collectValueUse(inst.value, used);
        break;
      case "load_mapping":
        this.collectValueUse(inst.key, used);
        break;
      case "compute_array_slot":
        if ("baseSlot" in inst) {
          this.collectValueUse(inst.baseSlot, used);
        }
        break;
      case "compute_slot":
        this.collectValueUse(inst.baseSlot, used);
        this.collectValueUse(inst.key, used);
        break;
      case "compute_field_offset":
        this.collectValueUse(inst.baseSlot, used);
        break;
      case "store_local":
        this.collectValueUse(inst.value, used);
        break;
      case "load_field":
      case "store_field":
        this.collectValueUse(inst.object, used);
        if (inst.kind === "store_field") {
          this.collectValueUse(inst.value, used);
        }
        break;
      case "load_index":
      case "store_index":
        this.collectValueUse(inst.array, used);
        this.collectValueUse(inst.index, used);
        if (inst.kind === "store_index") {
          this.collectValueUse(inst.value, used);
        }
        break;
      case "hash":
        this.collectValueUse(inst.value, used);
        break;
      case "slice":
        this.collectValueUse(inst.object, used);
        this.collectValueUse(inst.start, used);
        this.collectValueUse(inst.end, used);
        break;
      case "cast":
        this.collectValueUse(inst.value, used);
        break;
      case "call":
        for (const arg of inst.arguments) {
          this.collectValueUse(arg, used);
        }
        break;
      case "length":
        this.collectValueUse(inst.object, used);
        break;
      case "phi":
        for (const value of inst.sources.values()) {
          this.collectValueUse(value, used);
        }
        break;
    }
  }

  private collectValueUse(value: Ir.Value, used: Set<string>): void {
    if (value.kind === "temp") {
      used.add(value.id);
    } else if (value.kind === "local") {
      used.add(value.name);
    }
  }

  private hasSideEffects(inst: Ir.Instruction): boolean {
    switch (inst.kind) {
      case "store_storage":
      case "store_mapping":
      case "store_local":
      case "store_field":
      case "store_index":
      case "call": // Function calls may have side effects
        return true;
      default:
        return false;
    }
  }
}
