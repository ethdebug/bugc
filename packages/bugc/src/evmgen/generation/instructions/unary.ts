import type * as Ir from "#ir";
import type { Stack, StackBrand } from "#evm";
import type { GenState, Transition } from "../../operations/index.js";

import { pipe, operations, rebrandTop } from "../../operations/index.js";
import { loadValue, storeValueIfNeeded } from "../values/index.js";

const { NOT, PUSHn, SUB } = operations;

/**
 * Generate code for unary operations
 */
export function generateUnary<S extends Stack>(
  inst: Ir.UnaryOpInstruction,
): Transition<S, readonly ["value", ...S]> {
  const map: {
    [O in Ir.UnaryOp]: (
      state: GenState<readonly ["a", ...S]>,
    ) => GenState<readonly [StackBrand, ...S]>;
  } = {
    not: NOT(),
    neg: pipe<readonly ["a", ...S]>()
      .then(rebrandTop("b"))
      .then(PUSHn(0n), { as: "a" })
      .then(SUB())
      .done(),
  };

  return pipe<S>()
    .then(loadValue(inst.operand), { as: "a" })
    .then(map[inst.op], { as: "value" })
    .then(storeValueIfNeeded(inst.dest))
    .done();
}
