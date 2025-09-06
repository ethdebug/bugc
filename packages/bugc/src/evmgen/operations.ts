import * as Evm from "#evm";
import type { _ } from "#evm";

import { type State, type StackItem, controls } from "#evmgen/state";

export const { rebrand, rebrandTop } = Evm.makeRebrands<
  State<_ & Evm.Stack>,
  StackItem & { brand: _ & Evm.Stack.Brand }
>(controls);

export type Transition<
  X extends Evm.Stack,
  Y extends Evm.Stack,
> = Evm.Transition<State<_ & Evm.Stack>, X, Y>;

export const pipe = Evm.makePipe<
  State<_ & Evm.Stack>,
  StackItem & { brand: _ & Evm.Stack.Brand }
>(controls);

export type RawOperations = Evm.Operations<
  State<_ & Evm.Stack>,
  StackItem & { brand: _ & Evm.Stack.Brand }
>;

export const rawOperations: RawOperations = Evm.makeOperations<
  State<_ & Evm.Stack>,
  StackItem & { brand: _ & Evm.Stack.Brand }
>(controls);

export type Operations = typeof operations;

export const operations = {
  ...rawOperations,

  DUPn: <S extends Evm.Stack>(
    position: number,
  ): Transition<S, readonly ["value", ...S]> => {
    if (position < 1 || position > 16) {
      throw new Error(`Cannot reach stack position ${position}`);
    }

    type DUPn = {
      [O in keyof RawOperations]: O extends `DUP${infer _N}` ? O : never;
    }[keyof RawOperations];

    const DUP = rawOperations[
      `DUP${position}` as DUPn
    ] as unknown as () => Transition<S, readonly [Evm.Stack.Brand, ...S]>;

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

  PUSHn: <S extends Evm.Stack>(
    value: bigint,
  ): Transition<readonly [...S], readonly ["value", ...S]> => {
    if (value === 0n) {
      return rawOperations.PUSH0();
    }

    const immediates = bigintToBytes(value);

    type PUSHn = {
      [O in keyof RawOperations]: O extends `PUSH${infer _N}` ? O : never;
    }[keyof RawOperations];
    const PUSH = rawOperations[`PUSH${immediates.length}` as PUSHn];

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
