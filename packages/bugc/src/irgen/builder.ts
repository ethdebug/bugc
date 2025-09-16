import type { IrState, Transition } from "./state.js";

/**
 * Builder interface for chaining IR generation operations
 */
export interface IrBuilder<T = void> {
  /**
   * Chain another transition after this one
   */
  then<U>(transition: Transition<U>): IrBuilder<U>;

  /**
   * Peek at the current value and state to build more operations
   */
  peek<U>(fn: (state: IrState, value: T) => IrBuilder<U>): IrBuilder<U>;

  /**
   * Convert this builder to a transition function
   */
  done(): Transition<T>;
}

/**
 * Create a new pipe builder for chaining IR operations
 */
export function pipe<T = void>(initial?: Transition<T>): IrBuilder<T> {
  return new IrPipeBuilder(initial ? [initial] : []);
}

/**
 * Internal implementation of the pipe builder
 */
class IrPipeBuilder<T> implements IrBuilder<T> {
  constructor(private transitions: Transition<unknown>[]) {}

  then<U>(transition: Transition<U>): IrBuilder<U> {
    return new IrPipeBuilder<U>([...this.transitions, transition]);
  }

  peek<U>(fn: (state: IrState, value: T) => IrBuilder<U>): IrBuilder<U> {
    const peekTransition: Transition<U> = (state) => {
      // Run transitions up to this point to get current value
      const result = this.runTransitions(state);
      // Run the peek function with current state and value
      const builder = fn(result.state, result.value as T);
      return builder.done()(result.state);
    };
    return new IrPipeBuilder<U>([peekTransition]);
  }

  done(): Transition<T> {
    return (state) =>
      this.runTransitions(state) as { state: IrState; value: T };
  }

  private runTransitions(state: IrState): { state: IrState; value: unknown } {
    let currentState = state;
    let currentValue: unknown = undefined;

    for (const transition of this.transitions) {
      const result = transition(currentState);
      currentState = result.state;
      currentValue = result.value;
    }

    return { state: currentState, value: currentValue };
  }
}

/**
 * Helper to create a transition that just returns a value
 */
export function value<T>(val: T): Transition<T> {
  return (state) => ({ state, value: val });
}

/**
 * Helper to create a transition that modifies state without producing a value
 */
export function modify(fn: (state: IrState) => IrState): Transition<void> {
  return (state) => ({ state: fn(state), value: undefined });
}
