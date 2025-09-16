import type * as Ir from "#ir";
import type {
  IrState,
  FunctionContext,
  Counters,
  BlockContext,
  LoopStack,
  ScopeStack,
  Transition,
} from "./state.js";
import { Error as IrgenError } from "./errors.js";
import { Severity } from "#result";
import { addError } from "./updates.js";

/**
 * Core operations for IR generation
 */
export const operations = {
  /**
   * Initialize a new function context
   */
  initializeFunction:
    (name: string): Transition<void> =>
    (state) => {
      const functionContext: FunctionContext = {
        id: name,
        locals: [],
        blocks: new Map(),
      };

      return {
        state: {
          ...state,
          function: functionContext,
          block: {
            id: "entry",
            instructions: [],
            terminator: undefined,
            predecessors: new Set(),
            phis: [],
          },
          scopes: {
            stack: [{ locals: new Map(), usedNames: new Map() }],
          },
          counters: {
            temp: 0,
            block: 1, // Start at 1 to match test expectations
          },
        },
        value: undefined,
      };
    },

  /**
   * Emit an instruction to current block
   */
  emit:
    (instruction: Ir.Instruction): Transition<void> =>
    (state) => ({
      state: updateBlock(state, (block) => ({
        ...block,
        instructions: [...block.instructions, instruction],
      })),
      value: undefined,
    }),

  /**
   * Generate a temporary ID
   */
  genTemp: (): Transition<string> => (state) => {
    const id = `t${state.counters.temp}`;
    return {
      state: updateCounters(state, (c) => ({ ...c, temp: c.temp + 1 })),
      value: id,
    };
  },

  /**
   * Create a new block ID (block is created when switching to it)
   */
  createBlock:
    (label: string): Transition<string> =>
    (state) => {
      const id = `${label}_${state.counters.block}`;
      // Just generate the ID and update counter
      // The actual block will be created when we switch to it
      return {
        state: updateCounters(state, (c) => ({ ...c, block: c.block + 1 })),
        value: id,
      };
    },

  /**
   * Switch to a different block (creating a new context if needed)
   */
  switchToBlock:
    (blockId: string): Transition<void> =>
    (state) => {
      // First sync current block to function if it's complete
      const syncedState = syncBlockToFunction(state);

      const existingBlock = syncedState.function.blocks.get(blockId);
      if (existingBlock) {
        // Switch to existing block
        return {
          state: {
            ...syncedState,
            block: {
              id: existingBlock.id,
              instructions: [...existingBlock.instructions],
              terminator: existingBlock.terminator,
              predecessors: new Set(existingBlock.predecessors),
              phis: [...existingBlock.phis],
            },
          },
          value: undefined,
        };
      }

      // Create new block context
      return {
        state: {
          ...syncedState,
          block: {
            id: blockId,
            instructions: [],
            terminator: undefined,
            predecessors: new Set(),
            phis: [],
          },
        },
        value: undefined,
      };
    },

  /**
   * Set block terminator
   */
  setTerminator:
    (terminator: Ir.Block.Terminator): Transition<void> =>
    (state) => {
      if (state.block.terminator) {
        return {
          state: addError(
            state,
            new IrgenError(
              `Block ${state.block.id} already has terminator`,
              undefined,
              Severity.Warning,
            ),
          ),
          value: undefined,
        };
      }

      return {
        state: updateBlock(state, (block) => ({ ...block, terminator })),
        value: undefined,
      };
    },

  /**
   * Add a predecessor to the current block
   */
  addPredecessor:
    (predecessorId: string): Transition<void> =>
    (state) => ({
      state: updateBlock(state, (block) => ({
        ...block,
        predecessors: new Set([...block.predecessors, predecessorId]),
      })),
      value: undefined,
    }),

  /**
   * Declare a local variable
   */
  declareLocal:
    (name: string, type: Ir.Type): Transition<Ir.Function.LocalVariable> =>
    (state) => {
      const scope = state.scopes.stack[state.scopes.stack.length - 1];
      if (!scope) {
        return {
          state: addError(
            state,
            new IrgenError("No scope available", undefined, Severity.Error),
          ),
          value: { id: name, name, type },
        };
      }

      const count = scope.usedNames.get(name) || 0;
      const id = count === 0 ? name : `${name}_${count}`;

      const local: Ir.Function.LocalVariable = { id, name, type };

      // Update scope with new local
      const newScope = {
        ...scope,
        locals: new Map([...scope.locals, [name, local]]),
        usedNames: new Map([...scope.usedNames, [name, count + 1]]),
      };

      // Update function with new local
      const newFunction = {
        ...state.function,
        locals: [...state.function.locals, local],
      };

      return {
        state: {
          ...state,
          function: newFunction,
          scopes: {
            stack: [...state.scopes.stack.slice(0, -1), newScope],
          },
        },
        value: local,
      };
    },

  /**
   * Look up a variable in scope
   */
  lookupVariable:
    (name: string): Transition<Ir.Function.LocalVariable | null> =>
    (state) => {
      // Search from innermost to outermost scope
      for (let i = state.scopes.stack.length - 1; i >= 0; i--) {
        const local = state.scopes.stack[i].locals.get(name);
        if (local) {
          return { state, value: local };
        }
      }
      return { state, value: null };
    },

  /**
   * Push a new scope
   */
  pushScope: (): Transition<void> => (state) => ({
    state: updateScopes(state, (scopes) => ({
      stack: [...scopes.stack, { locals: new Map(), usedNames: new Map() }],
    })),
    value: undefined,
  }),

  /**
   * Pop a scope
   */
  popScope: (): Transition<void> => (state) => {
    if (state.scopes.stack.length <= 1) {
      return {
        state: addError(
          state,
          new IrgenError("Cannot pop last scope", undefined, Severity.Error),
        ),
        value: undefined,
      };
    }

    return {
      state: updateScopes(state, (scopes) => ({
        stack: scopes.stack.slice(0, -1),
      })),
      value: undefined,
    };
  },

  /**
   * Push loop context
   */
  pushLoop:
    (continueTarget: string, breakTarget: string): Transition<void> =>
    (state) => ({
      state: updateLoops(state, (loops) => ({
        stack: [...loops.stack, { continueTarget, breakTarget }],
      })),
      value: undefined,
    }),

  /**
   * Pop loop context
   */
  popLoop: (): Transition<void> => (state) => ({
    state: updateLoops(state, (loops) => ({
      stack: loops.stack.slice(0, -1),
    })),
    value: undefined,
  }),

  /**
   * Get current loop context
   */
  getCurrentLoop:
    (): Transition<{
      continueTarget: string;
      breakTarget: string;
    } | null> =>
    (state) => {
      const loop = state.loops.stack[state.loops.stack.length - 1];
      return { state, value: loop || null };
    },

  /**
   * Sync current block back to function
   */
  syncBlock: (): Transition<void> => (state) => ({
    state: syncBlockToFunction(state),
    value: undefined,
  }),
};

/**
 * Update the current block context
 */
function updateBlock(
  state: IrState,
  fn: (block: BlockContext) => BlockContext,
): IrState {
  return {
    ...state,
    block: fn(state.block),
  };
}

/**
 * Update the scope stack
 */
function updateScopes(
  state: IrState,
  fn: (scopes: ScopeStack) => ScopeStack,
): IrState {
  return {
    ...state,
    scopes: fn(state.scopes),
  };
}

/**
 * Update the loop stack
 */
function updateLoops(
  state: IrState,
  fn: (loops: LoopStack) => LoopStack,
): IrState {
  return {
    ...state,
    loops: fn(state.loops),
  };
}

/**
 * Update the counters
 */
function updateCounters(
  state: IrState,
  fn: (counters: Counters) => Counters,
): IrState {
  return {
    ...state,
    counters: fn(state.counters),
  };
}

/**
 * Update the current block in the current function
 * Only syncs if the block has a terminator (is complete)
 */
function syncBlockToFunction(state: IrState): IrState {
  // Only sync blocks that have terminators
  if (!state.block.terminator) {
    return state;
  }

  const blocks = new Map(state.function.blocks);
  blocks.set(state.block.id, {
    id: state.block.id,
    instructions: state.block.instructions,
    phis: [],
    terminator: state.block.terminator,
    predecessors: state.block.predecessors,
  } as Ir.Block);

  return updateFunction(state, (func) => ({
    ...func,
    blocks,
  }));
}

/**
 * Update the current function context
 */
export function updateFunction(
  state: IrState,
  fn: (func: FunctionContext) => FunctionContext,
): IrState {
  return {
    ...state,
    function: fn(state.function),
  };
}
