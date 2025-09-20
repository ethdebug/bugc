import * as Ir from "#ir";
import {
  BaseOptimizationStep,
  type OptimizationContext,
} from "../optimizer.js";

export class ConstantPropagationStep extends BaseOptimizationStep {
  name = "constant-propagation";

  run(module: Ir.Module, context: OptimizationContext): Ir.Module {
    const optimized = this.cloneModule(module);

    // Process each function separately
    this.processAllFunctions(optimized, (func) => {
      // Track known constant values across the function
      const constants = new Map<string, bigint | boolean | string>();

      for (const block of func.blocks.values()) {
        const newInstructions: Ir.Instruction[] = [];

        for (const inst of block.instructions) {
          let newInst = inst;

          // Track constant assignments
          if (inst.kind === "const" && "dest" in inst) {
            constants.set(inst.dest, inst.value);
          } else {
            // Try to propagate constants into instruction operands
            const propagated = this.propagateConstantsIntoInstruction(
              inst,
              constants,
            );
            if (propagated !== inst) {
              newInst = propagated;

              context.trackTransformation({
                type: "replace",
                pass: this.name,
                original: inst.loc ? [inst.loc] : [],
                result: newInst.loc ? [newInst.loc] : [],
                reason: "Propagated constants into instruction operands",
              });
            }

            // Clear constant info if instruction has side effects
            if (this.hasSideEffects(inst)) {
              // Conservative: clear all constant info
              // A more sophisticated analysis would track what's invalidated
              constants.clear();
            }
          }

          newInstructions.push(newInst);
        }

        block.instructions = newInstructions;
      }
    });

    return optimized;
  }

  private propagateConstantsIntoInstruction(
    inst: Ir.Instruction,
    constants: Map<string, bigint | boolean | string>,
  ): Ir.Instruction {
    // Clone instruction and replace temp operands with constants where possible
    const result = { ...inst };

    const propagateValue = (value: Ir.Value): Ir.Value => {
      if (value.kind === "temp") {
        const constValue = constants.get(value.id);
        if (constValue !== undefined) {
          return {
            kind: "const",
            value: constValue,
            type: value.type || this.getTypeForValue(constValue),
          };
        }
      }
      return value;
    };

    // Apply propagation based on instruction type
    switch (result.kind) {
      case "binary":
        result.left = propagateValue(result.left);
        result.right = propagateValue(result.right);
        break;
      case "unary":
        result.operand = propagateValue(result.operand);
        break;
      case "write":
        if (result.slot) result.slot = propagateValue(result.slot);
        if (result.value) result.value = propagateValue(result.value);
        if (result.offset) result.offset = propagateValue(result.offset);
        if (result.length) result.length = propagateValue(result.length);
        break;
      case "read":
        if (result.slot) result.slot = propagateValue(result.slot);
        if (result.offset) result.offset = propagateValue(result.offset);
        if (result.length) result.length = propagateValue(result.length);
        break;
      case "compute_slot":
        result.base = propagateValue(result.base);
        if (result.key) result.key = propagateValue(result.key);
        break;
      case "hash":
        result.value = propagateValue(result.value);
        break;
      case "slice":
        result.object = propagateValue(result.object);
        result.start = propagateValue(result.start);
        result.end = propagateValue(result.end);
        break;
      case "cast":
        result.value = propagateValue(result.value);
        break;
    }

    // Check if we actually changed anything by comparing each field
    // Can't use JSON.stringify because it doesn't support BigInt
    let changed = false;

    // Compare based on instruction type
    if (result.kind !== inst.kind) {
      changed = true;
    } else {
      // For now, assume any propagation means a change
      // A more sophisticated check would compare all fields
      changed = true;
    }

    return changed ? result : inst;
  }

  private getTypeForValue(value: bigint | boolean | string): Ir.Type {
    if (typeof value === "boolean") {
      return { kind: "bool" };
    } else if (typeof value === "bigint") {
      return { kind: "uint", bits: 256 };
    } else {
      return { kind: "string" };
    }
  }

  private hasSideEffects(inst: Ir.Instruction): boolean {
    switch (inst.kind) {
      case "write":
        return true;
      default:
        return false;
    }
  }
}
