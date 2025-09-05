import { $ } from "./hkts.js";
import type {
  Stack,
  StackBrand,
  StackItems,
  TopN,
  PopN,
  Push,
} from "./stack.js";

/**
 * Type-unsafe representation of EVM execution state containing a stack.
 * The type parameter U represents the concrete state implementation.
 */
export type UnsafeState<U> = $<U, [Stack]>;

/**
 * Type-unsafe representation of a single stack item.
 * The type parameter I represents the concrete stack item implementation.
 */
export type UnsafeStackItem<I> = $<I, [StackBrand]>;

/**
 * Represents an EVM instruction with its mnemonic, opcode, and optional immediate values.
 */
export interface Instruction {
  mnemonic: string;
  opcode: number;
  immediates?: number[];
}

/**
 * Low-level, type-unsafe operations on EVM execution state.
 * These operations work directly with the concrete implementations without type safety.
 */
export interface UnsafeStateControls<U, I> {
  /** Remove items from the top of the stack, returning the remaining state */
  slice(state: UnsafeState<U>, start?: number, end?: number): UnsafeState<U>;

  /** Add a new item to the top of the stack */
  prepend(state: UnsafeState<U>, item: UnsafeStackItem<I>): UnsafeState<U>;

  /** Read the top N items from the stack without modifying the state */
  readTop(state: UnsafeState<U>, num: number): readonly UnsafeStackItem<I>[];

  /** Create a new stack item with a unique identifier and type brand */
  create(id: string, brand: StackBrand): UnsafeStackItem<I>;

  /** Create a copy of an existing stack item with a new identifier */
  duplicate(item: UnsafeStackItem<I>, id: string): UnsafeStackItem<I>;

  /** Rebrand a stack item while keeping everything else the same */
  rebrand(item: UnsafeStackItem<I>, brand: StackBrand): UnsafeStackItem<I>;

  /** Generate a unique identifier and update state to track it */
  generateId(
    state: UnsafeState<U>,
    prefix?: string,
  ): {
    id: string;
    state: UnsafeState<U>;
  };

  /** Emit an instruction and update the execution state accordingly */
  emit(state: UnsafeState<U>, instruction: Instruction): UnsafeState<U>;
}

export type StateControls<U, I> = ReturnType<typeof makeStateControls<U, I>>;

/**
 * Creates type-safe wrappers around unsafe state control operations.
 * This provides compile-time guarantees about stack operations while delegating
 * the actual implementation to the unsafe controls.
 */
export const makeStateControls = <U, I>({
  slice,
  prepend,
  readTop,
  generateId,
  create,
  duplicate,
  rebrand,
  emit,
}: UnsafeStateControls<U, I>) =>
  ({
    /** Pop N items from the stack, updating the stack type accordingly */
    popN<S extends Stack, N extends number>(
      state: $<U, [S]>,
      num: N,
    ): $<U, [PopN<S, N>]> {
      return slice(state, num) as unknown;
    },
    /** Push an item onto the stack, updating the stack type accordingly */
    push<S extends Stack, B extends StackBrand>(
      state: $<U, [S]>,
      item: $<I, [B]>,
    ): $<U, [Push<S, [B]>]> {
      return prepend(state, item) as unknown;
    },
    /** Read the top N items from the stack with proper typing */
    topN<S extends Stack, N extends number>(
      state: $<U, [S]>,
      num: N,
    ): StackItems<I, TopN<S, N>> {
      return readTop(state, num) as unknown as StackItems<I, TopN<S, N>>;
    },
    /** Create a new typed stack item */
    create<B extends StackBrand>(id: string, brand: B): $<I, [B]> {
      return create(id, brand);
    },
    /** Duplicate a typed stack item with a new identifier */
    duplicate<B extends StackBrand>(item: $<I, [B]>, id: string) {
      return duplicate(item, id);
    },
    /** Duplicate a typed stack item with a new identifier */
    rebrand<B extends StackBrand>(item: $<I, [B]>, brand: B) {
      return rebrand(item, brand);
    },
    /** Generate a unique identifier while preserving stack type */
    generateId<S extends Stack>(
      state: $<U, [S]>,
      prefix?: string,
    ): {
      id: string;
      state: $<U, [S]>;
    } {
      return generateId(state, prefix);
    },
    /** Emit an instruction while preserving stack type */
    emit<S extends Stack>(
      state: $<U, [S]>,
      instruction: Instruction,
    ): $<U, [S]> {
      return emit(state, instruction);
    },
  }) as const;

/**
 * Configuration options for creating EVM operation functions.
 */
export interface MakeOperationOptions<C extends Stack, P extends Stack> {
  /** Stack types that this operation will consume (pop from stack) */
  consumes: C;
  /** Stack types that this operation will produce (push to stack) */
  produces: P;
  /** Optional prefix for generated identifiers */
  idPrefix?: string;
}

/**
 * Creates factory functions for building type-safe EVM operations.
 * This is the main entry point for creating operations that consume and produce
 * stack items with compile-time type safety.
 */
export const makeSpecifiers = <U, I>(controls: StateControls<U, I>) => {
  /**
   * Core implementation shared by both operation factories.
   * Handles the common pattern of: pop items -> generate IDs -> push results -> emit instruction
   */
  const executeOperation = <
    S extends Stack,
    C extends Stack,
    P extends Stack,
    T extends Instruction,
    P2 extends Stack = P,
  >(
    initialState: $<U, [readonly [...C, ...S]]>,
    consumes: C,
    produces: P,
    instruction: T,
    idPrefix?: string,
    options?: { produces: P2 },
  ): $<U, [readonly [...P2, ...S]]> => {
    let state = controls.popN<S, C["length"]>(initialState, consumes.length);

    let id;
    for (let i = produces.length - 1; i >= 0; i--) {
      ({ id, state } = controls.generateId(state, idPrefix));
      state = controls.push(
        state,
        controls.create(id, (options?.produces || produces)[i]),
      );
    }

    return controls.emit(state, instruction);
  };

  /**
   * Creates operation functions for instructions that don't require immediate values.
   * Returns a curried function: options -> instruction -> state transition function
   */
  const makeOperationForInstruction =
    <C extends Stack, P extends Stack>({
      consumes,
      produces,
      idPrefix,
    }: MakeOperationOptions<C, P>) =>
    <T extends Instruction>(instruction: T) =>
    () =>
    <S extends Stack>(
      initialState: $<U, [readonly [...C, ...S]]>,
    ): $<U, [readonly [...P, ...S]]> =>
      executeOperation(
        initialState,
        consumes,
        produces,
        instruction,
        idPrefix,
        undefined,
      );

  /**
   * Creates operation functions for instructions that require immediate values.
   * Returns a curried function: options -> instruction -> state transition function
   * The resulting function requires an immediates parameter.
   */
  const makeOperationWithImmediatesForInstruction =
    <C extends Stack, P extends Stack>({
      consumes,
      produces,
      idPrefix,
    }: MakeOperationOptions<C, P>) =>
    <T extends Instruction>(instruction: T) =>
    (immediates: number[]) =>
    <S extends Stack>(
      initialState: $<U, [readonly [...C, ...S]]>,
    ): $<U, [readonly [...P, ...S]]> =>
      executeOperation(
        initialState,
        consumes,
        produces,
        { ...instruction, immediates },
        idPrefix,
        undefined,
      );

  return {
    makeOperationForInstruction,
    makeOperationWithImmediatesForInstruction,
  };
};

/**
 * Maps a list of instructions to their corresponding operation functions.
 * Creates an object where keys are instruction mnemonics and values are of type F.
 */
export type MappedInstructions<L extends readonly Instruction[], F> = {
  [M in L[number]["mnemonic"]]: F;
};

/**
 * Helper function to create a mnemonic-keyed mapping for a single instruction.
 * Useful for building instruction operation lookup tables.
 */
export const mapInstruction = <T extends Instruction, F>(
  instruction: T,
  forInstruction: (instruction: T) => F,
): MappedInstructions<readonly [T], F> =>
  ({
    [instruction.mnemonic]: forInstruction(instruction),
  }) as MappedInstructions<readonly [T], F>;
