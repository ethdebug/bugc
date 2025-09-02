import {
  type Stack,
  type StackBrand,
  type Operations as GenericOperations,
  type _,
  makeOperations,
  makeRebrands,
} from "../../evm";

import { type GenState, type StackItem, controls } from "./state";

export const { rebrand, rebrandTop } = makeRebrands(controls);

export type EvmOperations = GenericOperations<
  GenState<_ & Stack>,
  StackItem & { brand: _ & StackBrand }
>;

export type Operations = typeof operations;

export const operations = {
  ...makeOperations(controls),

  DUPn: <S extends Stack, B extends StackBrand = "value">(
    state: GenState<S>,
    position: number,
    options?: {
      brand: B;
    },
  ): GenState<readonly [B, ...S]> => {
    // Check if stack has enough elements
    if (position < 1 || position > 16 || state.stack.length < position) {
      throw new Error("Stack too short");
    }

    const dupOptions = options
      ? { produces: [options.brand] as const }
      : undefined;

    type DUPn = {
      [O in keyof EvmOperations]: O extends `DUP${infer _N}` ? O : never;
    }[keyof EvmOperations];

    const DUP = operations[`DUP${position}` as DUPn] as <
      S extends Stack,
      P extends Stack
    >(
      state: GenState<S>,
      options?: {
        produces: P;
      },
    ) => GenState<readonly [...P, ...S]>;

    return DUP<S, readonly [B]>(state, dupOptions);
  },

  PUSHn: <S extends Stack, B extends StackBrand = "value">(
    state: GenState<S>,
    value: bigint,
    options?: {
      brand: B;
    },
  ): GenState<readonly [B, ...S]> => {
    const pushOptions = options
      ? { produces: [options.brand] as const }
      : undefined;

    if (value === 0n) {
      const newState = operations.PUSH0<S, readonly [B]>(state, pushOptions);
      return newState;
    }

    const immediates = bigintToBytes(value);

    type PUSHn = {
      [O in keyof EvmOperations]: O extends `PUSH${infer _N}` ? O : never;
    }[keyof EvmOperations];
    const PUSH = operations[`PUSH${immediates.length}` as PUSHn] as <
      S extends Stack,
      P extends Stack,
    >(
      state: GenState<S>,
      immediates: number[],
      options?: {
        produces: P;
      },
    ) => GenState<readonly [...P, ...S]>;

    return PUSH<S, readonly [B]>(state, immediates, pushOptions);
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
