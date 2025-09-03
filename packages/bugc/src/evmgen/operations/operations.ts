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

export type Transition<X extends Stack, Y extends Stack> = GenericTransition<
  GenState<_ & Stack>,
  X,
  Y
>;

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

  DUPn: <S extends Stack>(
    position: number,
  ): Transition<S, readonly ["value", ...S]> => {
    if (position < 1 || position > 16) {
      throw new Error(`Cannot reach stack position ${position}`);
    }

    type DUPn = {
      [O in keyof EvmOperations]: O extends `DUP${infer _N}` ? O : never;
    }[keyof EvmOperations];

    const DUP = operations[
      `DUP${position}` as DUPn
    ] as unknown as () => Transition<S, readonly [StackBrand, ...S]>;

    return pipe<S>()
      .peek((state, builder) => {
        // Check if stack has enough elements
        if (state.stack.length < position) {
          throw new Error("Stack too short");
        }

        return builder;
      })
      .then(DUP(), { as: "value" })
      .done();
  },

  PUSHn: <S extends Stack>(
    value: bigint,
  ): Transition<S, readonly ["value", ...S]> => {
    if (value === 0n) {
      return operations.PUSH0();
    }

    const immediates = bigintToBytes(value);

    type PUSHn = {
      [O in keyof EvmOperations]: O extends `PUSH${infer _N}` ? O : never;
    }[keyof EvmOperations];
    const PUSH = operations[`PUSH${immediates.length}` as PUSHn];

    return PUSH(immediates);
  },
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
