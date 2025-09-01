/**
 * Liveness Analysis for EVM Code Generation
 *
 * Determines which values are live at each point in the program,
 * essential for memory allocation and stack management.
 */

import type { IrModule, IrFunction, Value, IrInstruction } from "../../ir";

export interface FunctionLivenessInfo {
  /** Values live at block entry */
  liveIn: Map<string, Set<string>>;
  /** Values live at block exit */
  liveOut: Map<string, Set<string>>;
  /** Last instruction where each value is used */
  lastUse: Map<string, string>;
  /** Values that cross block boundaries */
  crossBlockValues: Set<string>;
}

/**
 * Get the ID from a Value
 */
function valueId(val: Value): string {
  if (val.kind === "const") {
    return `$const_${val.value}`;
  } else if (val.kind === "temp") {
    return val.id;
  } else {
    return val.name;
  }
}

/**
 * Collect all values used by an instruction
 */
function getUsedValues(inst: IrInstruction): Set<string> {
  const used = new Set<string>();

  // Helper to add a value if it's not a constant
  const addValue = (val: Value | undefined): void => {
    if (val && val.kind !== "const") {
      used.add(valueId(val));
    }
  };

  // Check instruction type and extract used values
  switch (inst.kind) {
    case "binary":
      addValue(inst.left);
      addValue(inst.right);
      break;
    case "unary":
      addValue(inst.operand);
      break;
    case "load_storage":
      addValue(inst.slot);
      break;
    case "store_storage":
      addValue(inst.slot);
      addValue(inst.value);
      break;
    case "load_mapping":
      addValue(inst.key);
      break;
    case "store_mapping":
      addValue(inst.key);
      addValue(inst.value);
      break;
    case "compute_slot":
      addValue(inst.baseSlot);
      addValue(inst.key);
      break;
    case "compute_array_slot":
      addValue(inst.baseSlot);
      break;
    case "compute_field_offset":
      addValue(inst.baseSlot);
      break;
    case "load_local":
      used.add(inst.local);
      break;
    case "store_local":
      addValue(inst.value);
      break;
    case "load_field":
      addValue(inst.object);
      break;
    case "store_field":
      addValue(inst.object);
      addValue(inst.value);
      break;
    case "load_index":
      addValue(inst.array);
      addValue(inst.index);
      break;
    case "store_index":
      addValue(inst.array);
      addValue(inst.index);
      addValue(inst.value);
      break;
    case "slice":
      addValue(inst.object);
      addValue(inst.start);
      addValue(inst.end);
      break;
    case "hash":
      addValue(inst.value);
      break;
    case "cast":
      addValue(inst.value);
      break;
    case "call":
      for (const arg of inst.arguments) {
        addValue(arg);
      }
      break;
    case "length":
      addValue(inst.object);
      break;
    case "phi":
      for (const source of inst.sources.values()) {
        addValue(source);
      }
      break;
    // These instructions don't use any values
    case "const":
    case "env":
      break;
  }

  return used;
}

/**
 * Get the value defined by an instruction
 */
function getDefinedValue(inst: IrInstruction): string | undefined {
  switch (inst.kind) {
    case "const":
    case "binary":
    case "unary":
    case "load_storage":
    case "load_mapping":
    case "compute_slot":
    case "compute_array_slot":
    case "compute_field_offset":
    case "load_local":
    case "load_field":
    case "load_index":
    case "slice":
    case "env":
    case "hash":
    case "cast":
    case "length":
    case "phi":
      return inst.dest;
    case "call":
      return inst.dest; // May be undefined for void functions
    case "store_local":
      return inst.local;
    // These instructions don't define values
    case "store_storage":
    case "store_mapping":
    case "store_field":
    case "store_index":
      return undefined;
  }
}

/**
 * Perform liveness analysis on a function
 */
export function analyzeLiveness(func: IrFunction): FunctionLivenessInfo {
  const liveIn = new Map<string, Set<string>>();
  const liveOut = new Map<string, Set<string>>();
  const lastUse = new Map<string, string>();
  const crossBlockValues = new Set<string>();

  // Initialize empty sets
  for (const blockId of func.blocks.keys()) {
    liveIn.set(blockId, new Set());
    liveOut.set(blockId, new Set());
  }

  // Track uses and defs per block
  const blockUses = new Map<string, Set<string>>();
  const blockDefs = new Map<string, Set<string>>();

  for (const [blockId, block] of func.blocks) {
    const uses = new Set<string>();
    const defs = new Set<string>();

    // Process phi nodes
    for (const phi of block.phis) {
      defs.add(phi.dest);
      // Phi sources will be handled in a separate pass
    }

    // Process instructions
    for (const inst of block.instructions) {
      // Uses before defs
      for (const used of getUsedValues(inst)) {
        if (!defs.has(used)) {
          uses.add(used);
        }
        lastUse.set(used, `${blockId}:${inst.kind}`);
      }

      const defined = getDefinedValue(inst);
      if (defined) {
        defs.add(defined);
      }
    }

    // Process terminator
    const term = block.terminator;
    if (term.kind === "branch") {
      const condId = valueId(term.condition);
      if (!defs.has(condId)) {
        uses.add(condId);
      }
      lastUse.set(condId, `${blockId}:branch`);
    } else if (term.kind === "return" && term.value) {
      const retId = valueId(term.value);
      if (!defs.has(retId)) {
        uses.add(retId);
      }
      lastUse.set(retId, `${blockId}:return`);
    }

    blockUses.set(blockId, uses);
    blockDefs.set(blockId, defs);
  }

  // Fixed-point iteration for liveness
  let changed = true;
  while (changed) {
    changed = false;

    for (const [blockId, block] of func.blocks) {
      const oldInSize = liveIn.get(blockId)!.size;
      const oldOutSize = liveOut.get(blockId)!.size;

      // LiveOut = union of LiveIn of all successors + phi sources
      const newOut = new Set<string>();
      const term = block.terminator;

      if (term.kind === "jump") {
        const succIn = liveIn.get(term.target);
        if (succIn) {
          for (const val of succIn) newOut.add(val);
        }
        // Add phi sources for this predecessor
        const succBlock = func.blocks.get(term.target);
        if (succBlock) {
          for (const phi of succBlock.phis) {
            const source = phi.sources.get(blockId);
            if (source && source.kind !== "const") {
              newOut.add(valueId(source));
              crossBlockValues.add(valueId(source));
            }
          }
        }
      } else if (term.kind === "branch") {
        const trueIn = liveIn.get(term.trueTarget);
        const falseIn = liveIn.get(term.falseTarget);
        if (trueIn) {
          for (const val of trueIn) newOut.add(val);
        }
        if (falseIn) {
          for (const val of falseIn) newOut.add(val);
        }
        // Add phi sources for both targets
        for (const target of [term.trueTarget, term.falseTarget]) {
          const succBlock = func.blocks.get(target);
          if (succBlock) {
            for (const phi of succBlock.phis) {
              const source = phi.sources.get(blockId);
              if (source && source.kind !== "const") {
                newOut.add(valueId(source));
                crossBlockValues.add(valueId(source));
              }
            }
          }
        }
      }

      liveOut.set(blockId, newOut);

      // LiveIn = (LiveOut - Defs) ∪ Uses
      const newIn = new Set<string>(newOut);
      const defs = blockDefs.get(blockId)!;
      const uses = blockUses.get(blockId)!;

      for (const def of defs) {
        newIn.delete(def);
      }
      for (const use of uses) {
        newIn.add(use);
      }

      liveIn.set(blockId, newIn);

      if (newIn.size !== oldInSize || newOut.size !== oldOutSize) {
        changed = true;
      }
    }
  }

  // Identify cross-block values
  for (const outSet of liveOut.values()) {
    for (const val of outSet) {
      crossBlockValues.add(val);
    }
  }

  return {
    liveIn,
    liveOut,
    lastUse,
    crossBlockValues,
  };
}

export interface LivenessInfo {
  create?: FunctionLivenessInfo;
  main?: FunctionLivenessInfo;
  functions: {
    [functionName: string]: FunctionLivenessInfo;
  };
}

/**
 * Analyze liveness for entire module
 */
export function analyzeModuleLiveness(module: IrModule): LivenessInfo {
  const result: LivenessInfo = {
    functions: {},
  };

  if (module.create) {
    result.create = analyzeLiveness(module.create);
  }

  result.main = analyzeLiveness(module.main);

  for (const [name, func] of module.functions) {
    result.functions[name] = analyzeLiveness(func);
  }

  return result;
}
