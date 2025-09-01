import type { Stack, StackBrand } from "../evm";
import type { GenState } from "./state";
import { type Operations, operations } from "./operations";

export function emitPush<S extends Stack, B extends StackBrand = "value">(
  state: GenState<S>,
  value: bigint,
  options?: {
    brand: B;
  },
): GenState<readonly [B, ...S]> {
  const pushOptions = options
    ? { produces: [options.brand] as const }
    : undefined;

  if (value === 0n) {
    const newState = operations.PUSH0<S, readonly [B]>(state, pushOptions);
    return newState;
  }

  const immediates = bigintToBytes(value);

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

type PUSHn = {
  [O in keyof Operations]: O extends `PUSH${infer _N}` ? O : never;
}[keyof Operations];

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
