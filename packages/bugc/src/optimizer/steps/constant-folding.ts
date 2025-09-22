import { keccak256 } from "ethereum-cryptography/keccak";

import * as Ir from "#ir";

import {
  BaseOptimizationStep,
  type OptimizationContext,
} from "../optimizer.js";

export class ConstantFoldingStep extends BaseOptimizationStep {
  name = "constant-folding";

  run(module: Ir.Module, context: OptimizationContext): Ir.Module {
    const optimized = this.cloneModule(module);

    // Process all functions in the module
    this.processAllFunctions(optimized, (func) => {
      // Track constant values per function
      const constants = new Map<string, bigint | boolean | string>();

      for (const block of func.blocks.values()) {
        const newInstructions: Ir.Instruction[] = [];

        for (let i = 0; i < block.instructions.length; i++) {
          const inst = block.instructions[i];

          if (inst.kind === "const") {
            // Track constant values
            if ("dest" in inst) {
              constants.set(inst.dest, inst.value);
            }
            newInstructions.push(inst);
          } else if (
            inst.kind === "binary" &&
            this.canFoldBinary(inst, constants)
          ) {
            // Try to fold binary operation
            const folded = this.foldBinary(inst, constants);
            if (folded) {
              newInstructions.push(folded);
              if (folded.kind === "const") {
                constants.set(folded.dest, folded.value);
              }

              context.trackTransformation({
                type: "replace",
                pass: this.name,
                original: inst.loc ? [inst.loc] : [],
                result: folded.loc ? [folded.loc] : [],
                reason: `Folded ${inst.op} operation on constants`,
              });
            } else {
              newInstructions.push(inst);
            }
          } else if (
            inst.kind === "hash" &&
            this.canFoldHash(inst, constants)
          ) {
            // Try to fold hash operation
            const folded = this.foldHash(inst, constants);
            if (folded) {
              newInstructions.push(folded);
              if (folded.kind === "const") {
                constants.set(folded.dest, folded.value);
              }

              context.trackTransformation({
                type: "replace",
                pass: this.name,
                original: inst.loc ? [inst.loc] : [],
                result: folded.loc ? [folded.loc] : [],
                reason: `Evaluated keccak256 on constant`,
              });
            } else {
              newInstructions.push(inst);
            }
          } else if (inst.kind === "length" && this.canFoldLength(inst)) {
            // Try to fold length operation
            const folded = this.foldLength(inst);
            if (folded) {
              newInstructions.push(folded);
              if (folded.kind === "const") {
                constants.set(folded.dest, folded.value);
              }

              context.trackTransformation({
                type: "replace",
                pass: this.name,
                original: inst.loc ? [inst.loc] : [],
                result: folded.loc ? [folded.loc] : [],
                reason: `Evaluated length of fixed-size array`,
              });
            } else {
              newInstructions.push(inst);
            }
          } else {
            newInstructions.push(inst);
          }
        }

        block.instructions = newInstructions;
      }
    });

    return optimized;
  }

  private canFoldBinary(
    inst: Ir.Instruction,
    constants: Map<string, bigint | boolean | string>,
  ): boolean {
    if (inst.kind !== "binary") return false;

    const leftValue = this.getConstantValue(inst.left, constants);
    const rightValue = this.getConstantValue(inst.right, constants);

    return leftValue !== undefined && rightValue !== undefined;
  }

  private foldBinary(
    inst: Ir.Instruction & { kind: "binary" },
    constants: Map<string, bigint | boolean | string>,
  ): Ir.Instruction | null {
    const leftValue = this.getConstantValue(inst.left, constants);
    const rightValue = this.getConstantValue(inst.right, constants);

    if (leftValue === undefined || rightValue === undefined) return null;

    const result = this.evaluateBinary(inst.op, leftValue, rightValue);
    if (result === undefined) return null;

    return {
      kind: "const",
      value: result,
      type: this.getResultType(inst.op, typeof result),
      dest: inst.dest,
      loc: inst.loc,
    };
  }

  private getConstantValue(
    value: Ir.Value,
    constants: Map<string, bigint | boolean | string>,
  ): bigint | boolean | string | undefined {
    if (value.kind === "const") {
      return value.value;
    } else if (value.kind === "temp") {
      return constants.get(value.id);
    }
    return undefined;
  }

  private evaluateBinary(
    op: string,
    left: bigint | boolean | string,
    right: bigint | boolean | string,
  ): bigint | boolean | undefined {
    if (typeof left === "bigint" && typeof right === "bigint") {
      switch (op) {
        case "add":
          return left + right;
        case "sub":
          return left - right;
        case "mul":
          return left * right;
        case "div":
          return right !== 0n ? left / right : undefined;
        case "mod":
          return right !== 0n ? left % right : undefined;
        case "lt":
          return left < right;
        case "gt":
          return left > right;
        case "le":
          return left <= right;
        case "ge":
          return left >= right;
        case "eq":
          return left === right;
        case "ne":
          return left !== right;
      }
    }

    if (typeof left === "boolean" && typeof right === "boolean") {
      switch (op) {
        case "and":
          return left && right;
        case "or":
          return left || right;
        case "eq":
          return left === right;
        case "ne":
          return left !== right;
      }
    }

    return undefined;
  }

  private getResultType(_op: string, resultType: string): Ir.Type {
    if (resultType === "boolean") {
      return Ir.Type.Scalar.bool;
    } else if (resultType === "bigint") {
      return Ir.Type.Scalar.uint256;
    }
    return Ir.Type.Scalar.bool;
  }

  private canFoldHash(
    inst: Ir.Instruction,
    constants: Map<string, bigint | boolean | string>,
  ): boolean {
    if (inst.kind !== "hash") return false;

    const inputValue = this.getConstantValue(inst.value, constants);
    // We can only fold if the input is a constant string
    return typeof inputValue === "string";
  }

  private foldHash(
    inst: Ir.Instruction & { kind: "hash" },
    constants: Map<string, bigint | boolean | string>,
  ): Ir.Instruction | null {
    const inputValue = this.getConstantValue(inst.value, constants);

    if (typeof inputValue !== "string") return null;

    // Convert string to bytes
    const encoder = new TextEncoder();
    const inputBytes = encoder.encode(inputValue);

    // Compute keccak256 hash
    const hashBytes = keccak256(inputBytes);

    // Convert hash bytes to bigint (bytes32 value)
    let hashValue = 0n;
    for (let i = 0; i < hashBytes.length; i++) {
      hashValue = (hashValue << 8n) | BigInt(hashBytes[i]);
    }

    return {
      kind: "const",
      value: hashValue,
      type: Ir.Type.Scalar.bytes32,
      dest: inst.dest,
      loc: inst.loc,
    };
  }

  private canFoldLength(inst: Ir.Instruction): boolean {
    if (inst.kind !== "length") return false;

    // In the new type system, we can't easily fold length without Bug type info
    // For now, disable length folding
    return false;
  }

  private foldLength(
    _inst: Ir.Instruction & { kind: "length" },
  ): Ir.Instruction | null {
    // Length folding disabled for now with new type system
    // Would need to check origin Bug type for array info

    return null;
  }
}
