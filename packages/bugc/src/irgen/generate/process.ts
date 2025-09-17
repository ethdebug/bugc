import type * as Ast from "#ast";
import * as Ir from "#ir";
import { State, type Modify, type Read, isModify, isRead } from "./state.js";

/**
 * State transition that may produce a value
 */
export type Transition<T = void> = (state: State) => Transition.Output<T>;

export namespace Transition {
  export interface Output<T> {
    state: State;
    value: T;
  }
}
/**
 * Generator type for IR operations
 * - Yields IrOperation commands
 * - Returns final value of type T
 * - Receives State back after peek operations
 */
export type Process<T> = Generator<Process.Action, T, State>;

export namespace Process {
  /**
   * Operation types that can be yielded from generators
   */
  export type Action =
    | { type: "modify"; fn: (state: State) => State }
    | { type: "peek" }
    | { type: "value"; value: any };

  export namespace Types {
    export const nodeType = lift(State.Types.nodeType);
  }

  export namespace Instructions {
    /**
     * Emit an instruction to the current block
     */
    export const emit = lift(State.Block.emit);
  }

  /**
   * Block operations for managing basic blocks in the IR
   */
  export namespace Blocks {
    /**
     * Set the terminator for the current block
     */
    export const terminate = lift(State.Block.setTerminator);

    export const currentTerminator = lift(State.Block.terminator);

    /**
     * Create a new block with a generated ID
     */
    export function* create(prefix: string): Process<string> {
      const state: State = yield { type: "peek" };
      const id = `${prefix}_${state.counters.block}`;
      yield* lift(State.Counters.consumeBlock)();
      return id;
    }

    /**
     * Switch to a different block, syncing the current block to the function
     */
    export function* switchTo(blockId: string): Process<void> {
      // First sync current block to function
      yield* syncCurrent();

      // Check if block already exists
      const state: State = yield { type: "peek" };
      const existingBlock = state.function.blocks.get(blockId);

      if (existingBlock) {
        // Switch to existing block, preserving its contents
        yield {
          type: "modify",
          fn: (state: State) => ({
            ...state,
            block: {
              id: existingBlock.id,
              instructions: [...existingBlock.instructions],
              terminator: existingBlock.terminator,
              predecessors: new Set(existingBlock.predecessors),
              phis: [...existingBlock.phis],
            },
          }),
        };
      } else {
        // Create new empty block
        const newBlock: State.Block = {
          id: blockId,
          instructions: [],
          terminator: undefined,
          predecessors: new Set(),
          phis: [],
        };

        yield {
          type: "modify",
          fn: (state: State) => ({
            ...state,
            block: newBlock,
          }),
        };
      }
    }

    /**
     * Sync current block to the function
     */
    export function* syncCurrent(): Process<void> {
      const state: State = yield { type: "peek" };
      const block = state.block;

      // Only sync if block has a terminator
      if (block.terminator) {
        const completeBlock: Ir.Block = {
          id: block.id,
          instructions: block.instructions,
          terminator: block.terminator,
          predecessors: block.predecessors,
          phis: block.phis,
        };

        yield* lift(State.Function.addBlock)(block.id, completeBlock);
      }
    }
  }

  /**
   * Variable and scope management
   */
  export namespace Variables {
    /**
     * Declare a new local variable in the current scope
     */
    export function* declare(
      name: string,
      type: Ir.Type,
    ): Process<Ir.Function.LocalVariable> {
      const scope = yield* lift(State.Scopes.current)();

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
      yield* lift(State.Scopes.setCurrent)(newScope);

      // Update function with new local
      yield* lift(State.Function.addLocal)(local);

      return local;
    }

    /**
     * Look up a variable by name in the scope chain
     */
    export const lookup = lift(State.Scopes.lookupVariable);

    /**
     * Generate a new temporary variable ID
     */
    export function* newTemp(): Process<string> {
      const temp = yield* lift(State.Counters.nextTemp)();
      const id = `t${temp}`;
      yield* lift(State.Counters.consumeTemp)();
      return id;
    }

    /**
     * Enter a new scope
     */
    export const enterScope = lift(State.Scopes.push);

    /**
     * Exit the current scope
     */
    export const exitScope = lift(State.Scopes.pop);
  }

  /**
   * Control flow context management
   */
  export namespace ControlFlow {
    /**
     * Enter a loop context
     */
    export const enterLoop = lift(State.Loops.push);

    /**
     * Exit the current loop context
     */
    export const exitLoop = lift(State.Loops.pop);

    /**
     * Get the current loop context
     */
    export function* currentLoop(): Process<State.Loop | null> {
      const state: State = yield { type: "peek" };
      const loop = state.loops.stack[state.loops.stack.length - 1];
      return loop || null;
    }
  }

  /**
   * Function building operations
   */
  export namespace Functions {
    /**
     * Initialize a new function context
     */
    export function* initialize(
      name: string,
      parameters: { name: string; type: Ir.Type }[],
    ): Process<void> {
      // Create function context
      const functionContext: State.Function = {
        id: name,
        locals: [],
        blocks: new Map(),
      };

      // Create initial block context
      const blockContext: State.Block = {
        id: "entry",
        instructions: [],
        terminator: undefined,
        predecessors: new Set(),
        phis: [],
      };

      // Update state with new contexts
      yield {
        type: "modify",
        fn: (state: State) => ({
          ...state,
          function: functionContext,
          block: blockContext,
          scopes: { stack: [{ locals: new Map(), usedNames: new Map() }] },
          loops: { stack: [] },
          counters: { ...state.counters, block: 1, temp: 0 },
        }),
      };

      // Declare parameters as locals
      for (const param of parameters) {
        yield* Variables.declare(param.name, param.type);
      }
    }

    /**
     * Get the current function's blocks
     */
    export function* currentBlocks(): Process<Map<string, Ir.Block>> {
      const state: State = yield { type: "peek" };
      return state.function.blocks;
    }

    /**
     * Get the current function's locals
     */
    export function* currentLocals(): Process<Ir.Function.LocalVariable[]> {
      const state: State = yield { type: "peek" };
      return state.function.locals;
    }

    /**
     * Finalize the current function
     */
    export function* finalize(): Process<Ir.Function> {
      // Sync final block
      yield* Blocks.syncCurrent();

      const state: State = yield { type: "peek" };
      const func = state.function;

      return {
        name: func.id,
        locals: func.locals,
        paramCount: 0, // This should be tracked properly
        entry: "entry",
        blocks: func.blocks,
      };
    }

    /**
     * Add a function to the module
     */
    export const addToModule = lift(State.Module.addFunction);
  }

  export namespace Modules {
    export function* current(): Process<State.Module> {
      const state: State = yield { type: "peek" };
      return state.module;
    }
  }

  /**
   * Storage operations
   */
  export namespace Storage {
    /**
     * Find a storage slot by name
     */
    export function* findSlot(name: string): Process<Ir.Module.StorageSlot | null> {
      const state: State = yield { type: "peek" };
      return state.module.storage.slots.find((s) => s.name === name) || null;
    }

    /**
     * Emit a compute_slot instruction
     */
    export function* computeSlot(
      baseSlot: Ir.Value,
      key: Ir.Value,
      loc?: Ast.SourceLocation,
    ): Process<Ir.Value> {
      const tempId = yield* Variables.newTemp();
      yield* Process.Instructions.emit({
        kind: "compute_slot",
        baseSlot,
        key,
        dest: tempId,
        loc,
      } as Ir.Instruction);
      return Ir.Value.temp(tempId, { kind: "uint", bits: 256 });
    }

    /**
     * Emit a load_storage instruction
     */
    export function* load(
      slot: Ir.Value,
      type: Ir.Type,
      loc?: Ast.SourceLocation,
    ): Process<Ir.Value> {
      const tempId = yield* Variables.newTemp();
      yield* Process.Instructions.emit({
        kind: "load_storage",
        slot,
        type,
        dest: tempId,
        loc,
      } as Ir.Instruction.LoadStorage);
      return Ir.Value.temp(tempId, type);
    }

    /**
     * Emit a store_storage instruction
     */
    export function* store(
      slot: Ir.Value,
      value: Ir.Value,
      loc?: Ast.SourceLocation,
    ): Process<void> {
      yield* Process.Instructions.emit({
        kind: "store_storage",
        slot,
        value,
        loc,
      } as Ir.Instruction.StoreStorage);
    }
  }

  /**
   * Error handling
   */
  export namespace Errors {
    /**
     * Report an error
     */
    export const report = lift(State.Errors.append);

    export const count = lift(State.Errors.count);

    /**
     * Report a warning
     */
    export const warning = lift(State.Warnings.append);

    /**
     * Attempt an operation, catching IrgenErrors
     */
    export const attempt = lift(State.Errors.attempt);
  }

  /**
   * Run a process with an initial state
   */
  export function run<T>(
    process: Process<T>,
    initialState: State,
  ): { state: State; value: T } {
    let state = initialState;
    let next = process.next();

    while (!next.done) {
      const action = next.value;

      switch (action.type) {
        case "modify": {
          state = action.fn(state);
          next = process.next(state);
          break;
        }
        case "peek": {
          next = process.next(state);
          break;
        }
        case "value": {
          // This is for returning values without state changes
          next = process.next(state);
          break;
        }
        default:
          throw new Error(`Unknown action type: ${(action as any).type}`);
      }
    }

    return { state, value: next.value };
  }
}

// Overloaded signatures for different return types
export function lift<A extends readonly unknown[]>(
  fn: (...args: A) => Modify<State>,
): (...args: A) => Process<void>;

export function lift<T, A extends readonly unknown[]>(
  fn: (...args: A) => Read<State, T>,
): (...args: A) => Process<T>;

export function lift<T, A extends readonly unknown[]>(
  fn: (...args: A) => Transition<T>,
): (...args: A) => Process<T>;

// Implementation
export function lift<T, A extends readonly unknown[]>(
  fn: (...args: A) => Modify<State> | Read<State, T> | Transition<T>,
) {
  return function* (...args: A): Process<T | void> {
    const result = fn(...args);

    if (isModify<State>(result)) {
      yield {
        type: "modify",
        fn: result,
      };
      return;
    }

    if (isRead<State, T>(result)) {
      return result(yield { type: "peek" });
    }

    // otherwise, it's a full Transition

    const { state, value } = result(yield { type: "peek" });

    yield {
      type: "modify",
      fn: () => state,
    };
    return value;
  };
}
