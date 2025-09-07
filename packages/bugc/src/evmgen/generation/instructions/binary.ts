import type * as Ir from "#ir";
import type { Stack } from "#evm";

import type { State } from "#evmgen/state";
import { type Transition, operations, pipe } from "#evmgen/operations";

import { loadValue, storeValueIfNeeded } from "../values/index.js";

const { ADD, SUB, MUL, DIV, MOD, EQ, LT, GT, AND, OR, NOT } = operations;

/**
 * Generate code for binary operations
 */
export function generateBinary<S extends Stack>(
  inst: Ir.Instruction.BinaryOp,
): Transition<S, readonly ["value", ...S]> {
  const map: {
    [O in Ir.Instruction.BinaryOp["op"]]: (
      state: State<readonly ["a", "b", ...S]>,
    ) => State<readonly [Stack.Brand, ...S]>;
  } = {
    add: ADD(),
    sub: SUB(),
    mul: MUL(),
    div: DIV(),
    mod: MOD(),
    eq: EQ(),
    ne: pipe<readonly ["a", "b", ...S]>()
      .then(EQ(), { as: "a" })
      .then(NOT())
      .done(),
    lt: LT(),
    le: pipe<readonly ["a", "b", ...S]>()
      .then(GT(), { as: "a" })
      .then(NOT())
      .done(),
    gt: GT(),
    ge: pipe<readonly ["a", "b", ...S]>()
      .then(LT(), { as: "a" })
      .then(NOT())
      .done(),
    and: AND(),
    or: OR(),
  };

  return pipe<S>()
    .then(loadValue(inst.left), { as: "b" })
    .then(loadValue(inst.right), { as: "a" })
    .then(map[inst.op], { as: "value" })
    .then(storeValueIfNeeded(inst.dest))
    .done();
}
