import type { IrState, Transition } from "./state.js";
import * as Ir from "#ir";
import { operations } from "./operations.js";
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
 * Get the current state (peek without modification)
 */
export function* peek(): IrGen<IrState> {
  const state = yield { type: "peek" };
  return state;
}

/**
 * Modify the state
 */
export function* modify(fn: (state: IrState) => IrState): IrGen<void> {
  yield { type: "modify", fn };
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
 * Helper to convert existing operations to generator-friendly versions
 */
export const gen = {
  /**
   * Get the current state
   */
  peek,

  /**
   * Modify the state
   */
  modify,

  /**
   * Emit an instruction
   */
  *emit(instruction: Ir.Instruction): IrGen<void> {
    yield* lift(operations.emit(instruction));
  },

  /**
   * Generate a temp variable
   */
  *genTemp(): IrGen<string> {
    return yield* lift(operations.genTemp());
  },

  /**
   * Lookup a variable
   */
  *lookupVariable(name: string): IrGen<{ id: string; type: Ir.Type } | null> {
    return yield* lift(operations.lookupVariable(name));
  },

  /**
   * Declare a local variable
   */
  *declareLocal(name: string, type: Ir.Type): IrGen<void> {
    yield* lift(operations.declareLocal(name, type));
  },

  /**
   * Generate a new block
   */
  *createBlock(prefix: string): IrGen<string> {
    return yield* lift(operations.createBlock(prefix));
  },

  /**
   * Switch to a block
   */
  *switchToBlock(blockId: string): IrGen<void> {
    yield* lift(operations.switchToBlock(blockId));
  },

  /**
   * Set block terminator
   */
  *setTerminator(terminator: Ir.Block.Terminator): IrGen<void> {
    yield* lift(operations.setTerminator(terminator));
  },

  /**
   * Sync the current block
   */
  *syncBlock(): IrGen<void> {
    yield* lift(operations.syncBlock());
  },

  /**
   * Push a new scope
   */
  *pushScope(): IrGen<void> {
    yield* lift(operations.pushScope());
  },

  /**
   * Pop the current scope
   */
  *popScope(): IrGen<void> {
    yield* lift(operations.popScope());
  },

  /**
   * Add an error
   */
  *addError(error: any): IrGen<void> {
    const state = yield* peek();
    const newState = addErrorUpdate(state, error);
    yield* modify(() => newState);
  },
};
