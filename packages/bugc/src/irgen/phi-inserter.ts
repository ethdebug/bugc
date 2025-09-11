/**
 * Phi Node Insertion
 *
 * This module implements the algorithm to insert phi nodes at control flow
 * join points in the IR. Phi nodes are necessary for proper SSA form when
 * values can come from multiple predecessors.
 *
 * This is now integrated into the IR generation phase to ensure we always
 * produce valid SSA form from the start.
 */

import * as Ir from "#ir";

interface LivenessInfo {
  /** Variables live at block entry */
  liveIn: Map<string, Set<string>>;
  /** Variables live at block exit */
  liveOut: Map<string, Set<string>>;
}

export class PhiInserter {
  /**
   * Insert phi nodes at control flow join points
   */
  insertPhiNodes(module: Ir.Module): Ir.Module {
    // Process each function
    if (module.create) {
      this.insertPhiNodesInFunction(module.create);
    }
    this.insertPhiNodesInFunction(module.main);
    for (const func of module.functions.values()) {
      this.insertPhiNodesInFunction(func);
    }

    return module;
  }

  private insertPhiNodesInFunction(func: Ir.Function): void {
    // Step 1: Compute dominator tree
    const dominators = this.computeDominatorTree(func);

    // Step 2: Compute dominance frontier using dominator tree
    const dominanceFrontier = this.computeDominanceFrontier(func, dominators);

    // Step 3: Collect variable definitions
    const definitions = this.collectVariableDefinitions(func);

    // Step 4: Compute liveness information
    const liveness = this.computeLiveness(func);

    // For each variable, insert phi nodes at dominance frontier
    for (const [varName, defBlocks] of Object.entries(definitions)) {
      const phiBlocks = new Set<string>();
      const workList = Array.from(defBlocks);

      while (workList.length > 0) {
        const block = workList.pop()!;
        const frontier = dominanceFrontier[block] || new Set();

        for (const frontierBlock of frontier) {
          if (!phiBlocks.has(frontierBlock)) {
            // Only insert phi if variable is live at this block
            const liveAtBlock = liveness.liveIn.get(frontierBlock) || new Set();

            if (liveAtBlock.has(varName)) {
              phiBlocks.add(frontierBlock);
              // Insert phi node
              this.insertPhiNode(func, frontierBlock, varName);
              // If we inserted a phi, that block now defines the variable
              if (!defBlocks.has(frontierBlock)) {
                workList.push(frontierBlock);
              }
            }
          }
        }
      }
    }
  }

  private collectVariableDefinitions(func: Ir.Function): VariableDefinitions {
    const definitions: VariableDefinitions = {};

    // Collect all assignments to temps and locals
    for (const [blockId, block] of func.blocks) {
      for (const inst of block.instructions) {
        if ("dest" in inst && inst.dest) {
          if (!definitions[inst.dest]) {
            definitions[inst.dest] = new Set();
          }
          definitions[inst.dest].add(blockId);
        }

        // Special handling for store_local - it defines the local
        if (inst.kind === "store_local") {
          const localName = inst.local;
          if (!definitions[localName]) {
            definitions[localName] = new Set();
          }
          definitions[localName].add(blockId);
        }
      }
    }

    return definitions;
  }

  private computeDominatorTree(
    func: Ir.Function,
  ): Record<string, string | null> {
    const dominators: Record<string, string | null> = {};
    const blockIds = Array.from(func.blocks.keys());

    // Build predecessor map
    const predecessors: Record<string, string[]> = {};
    for (const blockId of blockIds) {
      predecessors[blockId] = Array.from(
        func.blocks.get(blockId)?.predecessors || [],
      );
    }

    // Entry block has no dominator
    dominators[func.entry] = null;

    // Initialize all other blocks
    for (const blockId of blockIds) {
      if (blockId !== func.entry) {
        dominators[blockId] = undefined!;
      }
    }

    // Fixed-point iteration
    let changed = true;
    while (changed) {
      changed = false;

      // Process in BFS order from entry
      const worklist = [func.entry];
      const processed = new Set<string>([func.entry]);

      while (worklist.length > 0) {
        const current = worklist.shift()!;
        const block = func.blocks.get(current);
        if (!block) continue;

        // Add successors to worklist
        const terminator = block.terminator;
        if (terminator.kind === "jump") {
          if (!processed.has(terminator.target)) {
            worklist.push(terminator.target);
            processed.add(terminator.target);
          }
        } else if (terminator.kind === "branch") {
          if (!processed.has(terminator.trueTarget)) {
            worklist.push(terminator.trueTarget);
            processed.add(terminator.trueTarget);
          }
          if (!processed.has(terminator.falseTarget)) {
            worklist.push(terminator.falseTarget);
            processed.add(terminator.falseTarget);
          }
        }

        if (current === func.entry) continue;

        const preds = predecessors[current] || [];
        if (preds.length === 0) continue;

        // Find first predecessor with a dominator
        let newDom: string | undefined;
        for (const pred of preds) {
          if (dominators[pred] !== undefined) {
            newDom = pred;
            break;
          }
        }

        if (newDom === undefined) continue;

        // Intersect with other predecessors
        for (const pred of preds) {
          if (pred !== newDom && dominators[pred] !== undefined) {
            newDom = this.intersectDominators(pred, newDom, dominators);
          }
        }

        if (dominators[current] !== newDom) {
          dominators[current] = newDom;
          changed = true;
        }
      }
    }

    return dominators;
  }

  private intersectDominators(
    b1: string,
    b2: string,
    dominators: Record<string, string | null>,
  ): string {
    let finger1: string | null = b1;
    let finger2: string | null = b2;

    const path1 = new Set<string>();
    while (finger1 !== null) {
      path1.add(finger1);
      finger1 = dominators[finger1] ?? null;
    }

    while (finger2 !== null) {
      if (path1.has(finger2)) {
        return finger2;
      }
      finger2 = dominators[finger2] ?? null;
    }

    throw new Error("No common dominator found");
  }

  private computeDominanceFrontier(
    func: Ir.Function,
    dominators: Record<string, string | null>,
  ): DominanceFrontier {
    const frontier: DominanceFrontier = {};

    // Initialize empty sets
    for (const blockId of func.blocks.keys()) {
      frontier[blockId] = new Set();
    }

    // For each block Y
    for (const [yId, yBlock] of func.blocks) {
      const preds = Array.from(yBlock.predecessors);

      // If Y has multiple predecessors, it might be in dominance frontier
      if (preds.length >= 2) {
        for (const predId of preds) {
          // Walk up from predecessor until we reach Y's immediate dominator
          let runner = predId;
          while (runner !== dominators[yId]) {
            if (!frontier[runner]) {
              frontier[runner] = new Set();
            }
            frontier[runner].add(yId);

            // Move up dominator tree
            const dominator = dominators[runner];
            if (dominator === null) break;
            runner = dominator;
          }
        }
      }
    }

    return frontier;
  }

  private insertPhiNode(
    func: Ir.Function,
    blockId: string,
    varName: string,
  ): void {
    const block = func.blocks.get(blockId);
    if (!block) return;

    // Check if phi already exists for this variable
    const existingPhi = block.phis.find((phi) => phi.dest === varName);
    if (existingPhi) return;

    // Determine the type of the variable
    const varType = this.getVariableType(func, varName);
    if (!varType) return;

    // Create phi node with sources from all predecessors
    const sources = new Map<string, Ir.Value>();
    for (const pred of block.predecessors) {
      // Initially, use the variable itself as the source
      // A later pass will resolve these to the actual reaching definitions
      sources.set(pred, {
        kind: varName.startsWith("t") ? "temp" : "local",
        id: varName.startsWith("t") ? varName : undefined,
        name: varName.startsWith("t") ? undefined : varName,
        type: varType,
      } as Ir.Value);
    }

    const phi: Ir.Block.Phi = {
      kind: "phi",
      sources,
      dest: varName,
      type: varType,
    };

    // Insert at the beginning of phi nodes
    block.phis.push(phi);
  }

  private computeLiveness(func: Ir.Function): LivenessInfo {
    const liveIn = new Map<string, Set<string>>();
    const liveOut = new Map<string, Set<string>>();

    // Initialize empty sets for all blocks
    for (const blockId of func.blocks.keys()) {
      liveIn.set(blockId, new Set());
      liveOut.set(blockId, new Set());
    }

    // Helper to get variables used by an instruction
    const getUsedVars = (inst: Ir.Instruction): Set<string> => {
      const used = new Set<string>();

      const addValue = (val: Ir.Value | undefined): void => {
        if (val && val.kind === "temp") {
          used.add(val.id);
        } else if (val && val.kind === "local") {
          used.add(val.name);
        }
      };

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
        case "load_local":
          // No values to add, uses local name
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
          if ("baseSlot" in inst) {
            addValue(inst.baseSlot);
          }
          if ("index" in inst && inst.index) {
            addValue(inst.index as Ir.Value);
          }
          break;
        case "compute_field_offset":
          addValue(inst.baseSlot);
          break;
        case "hash":
          addValue(inst.value);
          break;
        case "slice":
          addValue(inst.object);
          if ("start" in inst) {
            addValue(inst.start);
          }
          if ("end" in inst) {
            addValue(inst.end);
          }
          break;
        case "length":
          if ("object" in inst) {
            addValue(inst.object);
          }
          break;
        case "call":
          if ("arguments" in inst && inst.arguments) {
            for (const arg of inst.arguments) {
              addValue(arg);
            }
          }
          break;
      }

      return used;
    };

    // Helper to get variables used by terminator
    const getTerminatorUsedVars = (term: Ir.Block.Terminator): Set<string> => {
      const used = new Set<string>();
      if (term.kind === "branch" && term.condition) {
        if (term.condition.kind === "temp") {
          used.add(term.condition.id);
        } else if (term.condition.kind === "local") {
          used.add(term.condition.name);
        }
      } else if (term.kind === "return" && term.value) {
        if (term.value.kind === "temp") {
          used.add(term.value.id);
        } else if (term.value.kind === "local") {
          used.add(term.value.name);
        }
      }
      return used;
    };

    // Fixed-point iteration to compute liveness
    let changed = true;
    while (changed) {
      changed = false;

      // Process blocks in reverse order for better convergence
      const blockIds = Array.from(func.blocks.keys()).reverse();

      for (const blockId of blockIds) {
        const block = func.blocks.get(blockId)!;
        const oldLiveOut = new Set(liveOut.get(blockId));

        // Compute live-out as union of live-in of all successors
        const newLiveOut = new Set<string>();

        // Find successors
        const successors: string[] = [];
        if (block.terminator.kind === "jump") {
          successors.push(block.terminator.target);
        } else if (block.terminator.kind === "branch") {
          successors.push(block.terminator.trueTarget);
          successors.push(block.terminator.falseTarget);
        }
        // For return, no successors

        // Union live-in of all successors
        for (const succ of successors) {
          const succLiveIn = liveIn.get(succ) || new Set();
          for (const v of succLiveIn) {
            newLiveOut.add(v);
          }
        }

        liveOut.set(blockId, newLiveOut);

        // Now compute live-in from live-out
        const live = new Set(newLiveOut);

        // Process terminator
        const termUsed = getTerminatorUsedVars(block.terminator);
        for (const v of termUsed) {
          live.add(v);
        }

        // Process instructions in reverse order
        for (let i = block.instructions.length - 1; i >= 0; i--) {
          const inst = block.instructions[i];

          // Remove defined variable
          if ("dest" in inst && inst.dest) {
            live.delete(inst.dest);
          }

          // Add used variables
          const used = getUsedVars(inst);
          for (const v of used) {
            live.add(v);
          }
        }

        // Update live-in
        const oldLiveIn = liveIn.get(blockId) || new Set();
        liveIn.set(blockId, live);

        // Check if changed
        if (!setsEqual(oldLiveOut, newLiveOut) || !setsEqual(oldLiveIn, live)) {
          changed = true;
        }
      }
    }

    return { liveIn, liveOut };
  }

  private getVariableType(func: Ir.Function, varName: string): Ir.Type | null {
    // Search through instructions to find the type of this variable
    for (const block of func.blocks.values()) {
      for (const inst of block.instructions) {
        if ("dest" in inst && inst.dest === varName && "type" in inst) {
          return inst.type as Ir.Type;
        }
      }
    }

    // Check locals
    const local = func.locals.find(
      (l) => l.id === varName || l.name === varName,
    );
    if (local) {
      return local.type;
    }

    return null;
  }
}

// Helper function to compare sets
function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

interface DominanceFrontier {
  [blockId: string]: Set<string>;
}

interface VariableDefinitions {
  [varName: string]: Set<string>; // Maps variable to blocks where it's defined
}

