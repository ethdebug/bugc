import type * as Ir from "#ir";
import type { Types } from "#types";
import type { Error as IrgenError } from "./errors.js";

/**
 * Main state for IR generation - immutable and passed through all operations
 */
export interface IrState {
  readonly module: PartialModule; // Module being built incrementally
  readonly function: FunctionContext; // Current function context
  readonly block: BlockContext; // Current block context
  readonly scopes: ScopeStack; // Variable scoping for name resolution
  readonly loops: LoopStack; // Loop contexts for break/continue
  readonly counters: Counters; // ID generation counters
  readonly types: Types; // Type information (read-only)
  readonly errors: IrgenError[]; // Accumulated errors
  readonly warnings: IrgenError[]; // Accumulated warnings
}

/**
 * Partially built module
 */
export interface PartialModule {
  readonly name: string;
  readonly storage: Ir.Module.StorageLayout;
  readonly functions: Map<string, Ir.Function>;
  readonly main?: Ir.Function;
  readonly create?: Ir.Function;
}

/**
 * Current function being built
 */
export interface FunctionContext {
  readonly id: string;
  readonly locals: Ir.Function.LocalVariable[]; // All locals in function
  readonly blocks: Map<string, Ir.Block>; // All blocks in function
}

/**
 * Current block being built - incomplete until terminator is set
 */
export interface BlockContext {
  readonly id: string;
  readonly instructions: Ir.Instruction[];
  readonly terminator?: Ir.Block.Terminator; // Optional during building
  readonly predecessors: Set<string>;
  readonly phis: Ir.Block.Phi[]; // Phi nodes for the block
}

/**
 * Variable scoping stack
 */
export interface ScopeStack {
  readonly stack: Scope[];
}

export interface Scope {
  readonly locals: Map<string, Ir.Function.LocalVariable>;
  readonly usedNames: Map<string, number>; // For handling shadowing
}

/**
 * Loop context stack
 */
export interface LoopStack {
  readonly stack: LoopContext[];
}

export interface LoopContext {
  readonly continueTarget: string; // Block ID for continue
  readonly breakTarget: string; // Block ID for break
}

/**
 * Counters for ID generation
 */
export interface Counters {
  readonly temp: number; // For temporary IDs (t0, t1, ...)
  readonly block: number; // For block IDs (block_1, block_2, ...)
}

/**
 * State transition that may produce a value
 */
export type Transition<T = void> = (state: IrState) => {
  state: IrState;
  value: T;
};

/**
 * For transitions that may fail
 */
export type TransitionResult<T = void> = (state: IrState) => {
  state: IrState;
  value: T;
  error?: IrgenError;
};
