import type { IrState, Transition } from "./state.js";
import * as Ir from "#ir";
import { operations } from "./operations.js";
import { Error as IrgenError } from "./errors.js";
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
  return yield* lift(operations.genTemp());
}

/**
 * Emit an instruction
 */
export function* emit(instruction: Ir.Instruction): IrGen<void> {
  yield* lift(operations.emit(instruction));
}

/**
 * Lookup a variable
 */
export function* lookupVariable(
  name: string,
): IrGen<{ id: string; type: Ir.Type } | null> {
  return yield* lift(operations.lookupVariable(name));
}

/**
 * Declare a local variable
 */
export function* declareLocal(
  name: string,
  type: Ir.Type,
): IrGen<Ir.Function.LocalVariable> {
  return yield* lift(operations.declareLocal(name, type));
}

/**
 * Generate a new block
 */
export function* createBlock(prefix: string): IrGen<string> {
  return yield* lift(operations.createBlock(prefix));
}

/**
 * Switch to a block
 */
export function* switchToBlock(blockId: string): IrGen<void> {
  return yield* lift(operations.switchToBlock(blockId));
}

/**
 * Set block terminator
 */
export function* setTerminator(terminator: Ir.Block.Terminator): IrGen<void> {
  return yield* lift(operations.setTerminator(terminator));
}
/**
 * Sync the current block
 */
export function* syncBlock(): IrGen<void> {
  return yield* lift(operations.syncBlock());
}

/**
 * Push a new scope
 */
export function* pushScope(): IrGen<void> {
  yield* lift(operations.pushScope());
}

/**
 * Pop the current scope
 */
export function* popScope(): IrGen<void> {
  yield* lift(operations.popScope());
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
