import {
  type Stack,
  type StackBrand,
  type Operations as GenericOperations,
  type Transition as GenericTransition,
  type _,
  makeOperations,
  makeRebrands,
  makePipe,
} from "../../evm";

import { type GenState, type StackItem, controls } from "./state";

export const { rebrand, rebrandTop } = makeRebrands(controls);

export type Transition<X extends Stack, Y extends Stack> =
  GenericTransition<GenState<_ & Stack>, X, Y>;

export const pipe = makePipe<
  GenState<_ & Stack>,
  StackItem & { brand: _ & StackBrand }
>(controls);

export type EvmOperations = GenericOperations<
  GenState<_ & Stack>,
  StackItem & { brand: _ & StackBrand }
>;

export type Operations = typeof operations;

export const operations = {
  ...makeOperations(controls),

  DUPn: <B extends StackBrand = "value">(
    position: number,
    options?: {
      brand: B;
    },
  ) => <S extends Stack>(
    state: GenState<S>
  ): GenState<readonly [B, ...S]> => {
    // Check if stack has enough elements
    if (position < 1 || position > 16 || state.stack.length < position) {
      throw new Error("Stack too short");
    }

    type DUPn = {
      [O in keyof EvmOperations]: O extends `DUP${infer _N}` ? O : never;
    }[keyof EvmOperations];

    const DUP = operations[`DUP${position}` as DUPn]() as <
      S extends Stack,
      P extends Stack
    >(
      state: GenState<S>,
    ) => GenState<readonly [...P, ...S]>;

    return rebrandTop(
      (options?.brand || "value") as B
    )(DUP<S, readonly ["unknown"]>(state));
  },

  PUSHn: <B extends StackBrand = "value">(
    value: bigint,
    options?: {
      brand: B;
    },
  ) => <S extends Stack>(
    state: GenState<S>,
  ): GenState<readonly [B, ...S]> => {
    const pushOptions = options
      ? { produces: [options.brand] as const }
      : undefined;

    if (value === 0n) {
      const newState = operations.PUSH0<readonly [B]>(pushOptions)<S>(state);
      return newState;
    }

    const immediates = bigintToBytes(value);

    type PUSHn = {
      [O in keyof EvmOperations]: O extends `PUSH${infer _N}` ? O : never;
    }[keyof EvmOperations];
    const PUSH = operations[`PUSH${immediates.length}` as PUSHn] as <
      P extends Stack,
    >(
      immediates: number[],
      options?: {
        produces: P;
      },
    ) => <
    S extends Stack,
    >(
      state: GenState<S>,
    ) => GenState<readonly [...P, ...S]>;

    return PUSH<readonly [B]>(immediates, pushOptions)<S>(state);
  }
};


function bigintToBytes(value: bigint): number[] {
  if (value === 0n) return [];

  const hex = value.toString(16);
  const padded = hex.length % 2 ? "0" + hex : hex;
  const bytes: number[] = [];

  for (let i = 0; i < padded.length; i += 2) {
    bytes.push(parseInt(padded.substr(i, 2), 16));
  }

  return bytes;
}
