import { $ } from "./hkts";
import type { Stack, StackBrand, StackItems, TopN, PopN, Push } from "./stack";

export type UnsafeState<U> = $<U, [Stack]>;
export type UnsafeStackItem<I> = $<I, [StackBrand]>;

export interface Instruction {
  mnemonic: string;
  opcode: number;
  immediates?: number[];
}

export interface UnsafeStateControls<U, I> {
  slice(state: UnsafeState<U>, start?: number, end?: number): UnsafeState<U>;

  prepend(state: UnsafeState<U>, item: UnsafeStackItem<I>): UnsafeState<U>;

  readTop(state: UnsafeState<U>, num: number): readonly UnsafeStackItem<I>[];

  create(id: string, brand: StackBrand): UnsafeStackItem<I>;

  duplicate(item: UnsafeStackItem<I>, id: string): UnsafeStackItem<I>;

  generateId(
    state: UnsafeState<U>,
    prefix?: string,
  ): {
    id: string;
    state: UnsafeState<U>;
  };

  emit(state: UnsafeState<U>, instruction: Instruction): UnsafeState<U>;
}

export type StateControls<U, I> = ReturnType<typeof makeStateControls<U, I>>;

export const makeStateControls = <U, I>({
  slice,
  prepend,
  readTop,
  generateId,
  create,
  duplicate,
  emit,
}: UnsafeStateControls<U, I>) =>
  ({
    popN<S extends Stack, N extends number>(
      state: $<U, [S]>,
      num: N,
    ): $<U, [PopN<S, N>]> {
      return slice(state, num) as unknown;
    },
    push<S extends Stack, B extends StackBrand>(
      state: $<U, [S]>,
      item: $<I, [B]>,
    ): $<U, [Push<S, [B]>]> {
      return prepend(state, item) as unknown;
    },
    topN<S extends Stack, N extends number>(
      state: $<U, [S]>,
      num: N,
    ): StackItems<I, TopN<S, N>> {
      return readTop(state, num) as unknown as StackItems<I, TopN<S, N>>;
    },
    create<B extends StackBrand>(id: string, brand: B): $<I, [B]> {
      return create(id, brand);
    },
    duplicate<B extends StackBrand>(item: $<I, [B]>, id: string) {
      return duplicate(item, id);
    },
    generateId<S extends Stack>(
      state: $<U, [S]>,
      prefix?: string,
    ): {
      id: string;
      state: $<U, [S]>;
    } {
      return generateId(state, prefix);
    },
    emit<S extends Stack>(
      state: $<U, [S]>,
      instruction: Instruction,
    ): $<U, [S]> {
      return emit(state, instruction);
    },
  }) as const;

export const makeMakeOperationForInstruction =
  <U, I>({ popN, generateId, create, push, emit }: StateControls<U, I>) =>
  <C extends Stack, P extends Stack>({
    consumes,
    produces,
    idPrefix,
  }: {
    consumes: C;
    produces: P;
    idPrefix?: string;
  }) =>
  <T extends Instruction>(instruction: T) =>
  <S extends Stack, P2 extends Stack = P>(
    initialState: $<U, [readonly [...C, ...S]]>,
    options?: {
      produces: P2;
    },
  ): $<U, [readonly [...P2, ...S]]> => {
    let state = popN<S, C["length"]>(initialState, consumes.length);

    let id;
    for (let i = produces.length - 1; i >= 0; i--) {
      ({ id, state } = generateId(state, idPrefix));
      state = push(state, create(id, (options?.produces || produces)[i]));
    }

    return emit(state, instruction);
  };

export const makeMakeOperationWithImmediatesForInstruction =
  <U, I>({ popN, generateId, create, push, emit }: StateControls<U, I>) =>
  <C extends Stack, P extends Stack>({
    consumes,
    produces,
    idPrefix,
  }: {
    consumes: C;
    produces: P;
    idPrefix?: string;
  }) =>
  <T extends Instruction>(instruction: T) =>
  <S extends Stack, P2 extends Stack = P>(
    initialState: $<U, [readonly [...C, ...S]]>,
    immediates: number[],
    options?: {
      produces: P2;
    },
  ): $<U, [readonly [...P2, ...S]]> => {
    let state = popN<S, C["length"]>(initialState, consumes.length);

    let id;
    for (let i = produces.length - 1; i >= 0; i--) {
      ({ id, state } = generateId(state, idPrefix));
      state = push(state, create(id, (options?.produces || produces)[i]));
    }

    return emit(state, { ...instruction, immediates });
  };

export type MappedInstructions<L extends readonly Instruction[], F> = {
  [M in L[number]["mnemonic"]]: F;
};

export const mapInstruction = <T extends Instruction, F>(
  instruction: T,
  forInstruction: (instruction: T) => F,
): MappedInstructions<readonly [T], F> =>
  ({
    [instruction.mnemonic]: forInstruction(instruction),
  }) as MappedInstructions<readonly [T], F>;
