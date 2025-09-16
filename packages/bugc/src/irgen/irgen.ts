import type {
  IrState,
  Transition,
  FunctionContext,
  BlockContext,
  ScopeStack,
  LoopStack,
  Counters,
} from "./state.js";
import * as Ir from "#ir";
import { Error as IrgenError } from "./errors.js";
import { Severity } from "#result";
import { addError as addErrorUpdate } from "./updates.js";

/**
 * Operation types that can be yielded from generators
 */
export type IrOperation =
  | { type: "modify"; fn: (state: IrState) => IrState }
  | { type: "peek" }
  | { type: "value"; value: any };

/**
 * Generator type for IR operations
 * - Yields IrOperation commands
 * - Returns final value of type T
 * - Receives IrState back after peek operations
 */
export type IrGen<T> = Generator<IrOperation, T, IrState>;

/**
 * Lift a transition into a generator operation
 */
export function* lift<T>(transition: Transition<T>): IrGen<T> {
  // Store the result value before yielding
  let result: T;
  yield {
    type: "modify",
    fn: (state) => {
      const transitionResult = transition(state);
      result = transitionResult.value;
      return transitionResult.state;
    },
  };
  // Return the stored value
  return result!;
}

/**
 * Run a generator with an initial state and return a Transition
 */
export function runGen<T>(gen: IrGen<T>): Transition<T> {
  return (initialState: IrState) => {
    let state = initialState;
    let next = gen.next();

    while (!next.done) {
      const op = next.value;

      switch (op.type) {
        case "modify": {
          state = op.fn(state);
          next = gen.next(state);
          break;
        }
        case "peek": {
          next = gen.next(state);
          break;
        }
        case "value": {
          // This is for returning values without state changes
          next = gen.next(state);
          break;
        }
        default:
          throw new Error(`Unknown operation type: ${(op as any).type}`);
      }
    }

    return { state, value: next.value };
  };
}

/**
 * Get the current state
 */
export function* peek(): IrGen<IrState> {
  return yield { type: "peek" };
}

/**
 * Generate a new temp
 */
export function* newTemp(): IrGen<string> {
  const state = yield* peek();
  const id = `t${state.counters.temp}`;
  yield* updateCounters((c) => ({ ...c, temp: c.temp + 1 }));
  return id;
}

/**
 * Emit an instruction
 */
export function* emit(instruction: Ir.Instruction): IrGen<void> {
  yield* updateBlock((block) => ({
    ...block,
    instructions: [...block.instructions, instruction],
  }));
}

/**
 * Lookup a variable
 */
export function* lookupVariable(
  name: string,
): IrGen<{ id: string; type: Ir.Type } | null> {
  const state = yield* peek();

  // Search from innermost to outermost scope
  for (let i = state.scopes.stack.length - 1; i >= 0; i--) {
    const local = state.scopes.stack[i].locals.get(name);
    if (local) {
      return local;
    }
  }
  return null;
}

/**
 * Declare a local variable
 */
export function* declareLocal(
  name: string,
  type: Ir.Type,
): IrGen<Ir.Function.LocalVariable> {
  const state = yield* peek();
  const scope = state.scopes.stack[state.scopes.stack.length - 1];

  if (!scope) {
    yield* addError(
      new IrgenError("No scope available", undefined, Severity.Error),
    );
    return { id: name, name, type };
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

  // Update scopes
  yield* updateScopes((scopes) => ({
    stack: [...scopes.stack.slice(0, -1), newScope],
  }));

  // Update function with new local
  yield* updateFunction((func) => ({
    ...func,
    locals: [...func.locals, local],
  }));

  return local;
}

/**
 * Generate a new block
 */
export function* createBlock(prefix: string): IrGen<string> {
  const state = yield* peek();
  const id = `${prefix}_${state.counters.block}`;
  // Just generate the ID and update counter
  // The actual block will be created when we switch to it
  yield* updateCounters((c) => ({ ...c, block: c.block + 1 }));
  return id;
}

/**
 * Switch to a block
 */
export function* switchToBlock(blockId: string): IrGen<void> {
  // First sync current block to function if it's complete
  yield* syncBlockToFunction();

  const state = yield* peek();
  const existingBlock = state.function.blocks.get(blockId);

  if (existingBlock) {
    // Switch to existing block
    yield* modify((s) => ({
      ...s,
      block: {
        id: existingBlock.id,
        instructions: [...existingBlock.instructions],
        terminator: existingBlock.terminator,
        predecessors: new Set(existingBlock.predecessors),
        phis: [...existingBlock.phis],
      },
    }));
  } else {
    // Create new block context
    yield* modify((s) => ({
      ...s,
      block: {
        id: blockId,
        instructions: [],
        terminator: undefined,
        predecessors: new Set(),
        phis: [],
      },
    }));
  }
}

/**
 * Set block terminator
 */
export function* setTerminator(terminator: Ir.Block.Terminator): IrGen<void> {
  const state = yield* peek();

  if (state.block.terminator) {
    yield* addError(
      new IrgenError(
        `Block ${state.block.id} already has terminator`,
        undefined,
        Severity.Warning,
      ),
    );
    return;
  }

  yield* updateBlock((block) => ({ ...block, terminator }));
}
/**
 * Sync the current block
 */
export function* syncBlock(): IrGen<void> {
  yield* syncBlockToFunction();
}

/**
 * Push a new scope
 */
export function* pushScope(): IrGen<void> {
  yield* updateScopes((scopes) => ({
    stack: [...scopes.stack, { locals: new Map(), usedNames: new Map() }],
  }));
}

/**
 * Pop the current scope
 */
export function* popScope(): IrGen<void> {
  const state = yield* peek();

  if (state.scopes.stack.length <= 1) {
    yield* addError(
      new IrgenError("Cannot pop last scope", undefined, Severity.Error),
    );
    return;
  }

  yield* updateScopes((scopes) => ({
    stack: scopes.stack.slice(0, -1),
  }));
}

/**
 * Initialize a new function context
 */
export function* initializeFunction(name: string): IrGen<void> {
  const functionContext: FunctionContext = {
    id: name,
    locals: [],
    blocks: new Map(),
  };

  yield* modify((state) => ({
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
    loops: {
      stack: [],
    },
  }));
}

/**
 * Push loop context
 */
export function* pushLoop(
  continueTarget: string,
  breakTarget: string,
): IrGen<void> {
  yield* updateLoops((loops) => ({
    stack: [...loops.stack, { continueTarget, breakTarget }],
  }));
}

/**
 * Pop loop context
 */
export function* popLoop(): IrGen<void> {
  yield* updateLoops((loops) => ({
    stack: loops.stack.slice(0, -1),
  }));
}

/**
 * Get current loop context
 */
export function* getCurrentLoop(): IrGen<{
  continueTarget: string;
  breakTarget: string;
} | null> {
  const state = yield* peek();
  const loop = state.loops.stack[state.loops.stack.length - 1];
  return loop || null;
}

/**
 * Add an error
 */
export function* addError(error: IrgenError): IrGen<void> {
  const state = yield* peek();
  const newState = addErrorUpdate(state, error);
  yield* modify(() => newState);
}

/**
 * Modify the state
 */
function* modify(fn: (state: IrState) => IrState): IrGen<void> {
  yield { type: "modify", fn };
}

// ============================================================================
// Helper generator functions for state updates
// ============================================================================

/**
 * Update the current block context
 */
function* updateBlock(fn: (block: BlockContext) => BlockContext): IrGen<void> {
  yield* modify((state) => ({
    ...state,
    block: fn(state.block),
  }));
}

/**
 * Update the scope stack
 */
function* updateScopes(fn: (scopes: ScopeStack) => ScopeStack): IrGen<void> {
  yield* modify((state) => ({
    ...state,
    scopes: fn(state.scopes),
  }));
}

/**
 * Update the loop stack
 */
function* updateLoops(fn: (loops: LoopStack) => LoopStack): IrGen<void> {
  yield* modify((state) => ({
    ...state,
    loops: fn(state.loops),
  }));
}

/**
 * Update the counters
 */
function* updateCounters(fn: (counters: Counters) => Counters): IrGen<void> {
  yield* modify((state) => ({
    ...state,
    counters: fn(state.counters),
  }));
}

/**
 * Update the current function context
 */
function* updateFunction(
  fn: (func: FunctionContext) => FunctionContext,
): IrGen<void> {
  yield* modify((state) => ({
    ...state,
    function: fn(state.function),
  }));
}

/**
 * Sync the current block back to function (if it has a terminator)
 */
function* syncBlockToFunction(): IrGen<void> {
  const state = yield* peek();

  // Only sync blocks that have terminators
  if (!state.block.terminator) {
    return;
  }

  const blocks = new Map(state.function.blocks);
  blocks.set(state.block.id, {
    id: state.block.id,
    instructions: state.block.instructions,
    phis: [],
    terminator: state.block.terminator,
    predecessors: state.block.predecessors,
  } as Ir.Block);

  yield* updateFunction((func) => ({
    ...func,
    blocks,
  }));
}
