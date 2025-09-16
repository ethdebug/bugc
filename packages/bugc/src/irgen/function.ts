import type * as Ast from "#ast";
import * as Ir from "#ir";
import { buildBlock } from "./statements/index.js";
import {
  type IrGen,
  setTerminator,
  declareLocal,
  initializeFunction,
  peek,
  syncBlock,
} from "./irgen.js";

/**
 * Compute predecessors for all blocks based on their terminators
 */
function computePredecessors(
  blocks: Map<string, Ir.Block>,
): Map<string, Ir.Block> {
  // Create new blocks with fresh predecessor sets
  const result = new Map<string, Ir.Block>();

  // First pass: create all blocks with empty predecessors
  for (const [id, block] of blocks) {
    result.set(id, {
      ...block,
      predecessors: new Set<string>(),
    });
  }

  // Second pass: add predecessors based on terminators
  for (const [sourceId, block] of blocks) {
    const terminator = block.terminator;
    if (!terminator) continue;

    // Add edges based on terminator type
    switch (terminator.kind) {
      case "jump": {
        const targetBlock = result.get(terminator.target);
        if (targetBlock) {
          targetBlock.predecessors.add(sourceId);
        }
        break;
      }
      case "branch": {
        const trueBlock = result.get(terminator.trueTarget);
        if (trueBlock) {
          trueBlock.predecessors.add(sourceId);
        }
        const falseBlock = result.get(terminator.falseTarget);
        if (falseBlock) {
          falseBlock.predecessors.add(sourceId);
        }
        break;
      }
      // "return" and "unreachable" have no successors
    }
  }

  return result;
}

/**
 * Build a function
 */
export function* buildFunction(
  name: string,
  parameters: {
    name: string;
    type: Ir.Type;
  }[],
  body: Ast.Block,
): IrGen<Ir.Function> {
  // Initialize function context
  yield* initializeFunction(name);

  // Add parameters as locals
  for (const param of parameters) {
    yield* declareLocal(param.name, param.type);
  }

  // Build function body
  yield* buildBlock(body);

  // Ensure function has a terminator
  {
    const state = yield* peek();
    if (!state.block.terminator) {
      // Add implicit return
      yield* setTerminator({
        kind: "return",
        value: undefined,
      });
    }
  }

  // Sync final block
  yield* syncBlock();

  // Create the function
  const finalState = yield* peek();

  // Compute predecessors from the control flow graph
  const blocks = computePredecessors(finalState.function.blocks);

  const func: Ir.Function = {
    name,
    locals: finalState.function.locals,
    paramCount: parameters.length,
    entry: "entry",
    blocks,
  };

  return func;
}
