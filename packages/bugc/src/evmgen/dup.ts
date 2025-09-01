import type { Stack } from "../evm";
import type { GenState } from "./state";
import { operations, type Operations } from "./operations";

/**
 * Type-safe DUP operation that preserves irValue annotations
 *
 * This function uses 'any' casts because TypeScript can't prove that
 * the stack has enough elements at compile time. We do runtime checking
 * via the position parameter.
 */
export function emitDup<S extends Stack>(
  state: GenState<S>,
  position: number,
): GenState<readonly ["unknown", ...S]> {
  // Check if stack has enough elements
  if (position < 1 || position > 16 || state.stack.length < position) {
    throw new Error("Stack too short");
  }

  const DUP = operations[`DUP${position}` as DUPn] as <S extends Stack>(
    state: GenState<S>,
  ) => GenState<readonly ["unknown", ...S]>;

  return DUP(state);
}

type DUPn = {
  [O in keyof Operations]: O extends `DUP${infer _N}` ? O : never;
}[keyof Operations];
