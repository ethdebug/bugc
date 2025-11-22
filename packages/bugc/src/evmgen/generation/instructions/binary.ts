import type * as Ir from "#ir";
import type { Stack } from "#evm";

import type { State } from "#evmgen/state";
import { type Transition, operations, pipe, rebrand } from "#evmgen/operations";

import { loadValue, storeValueIfNeeded } from "../values/index.js";

const { ADD, SUB, MUL, DIV, MOD, EQ, LT, GT, AND, OR, NOT, SHL, SHR } =
  operations;

/**
 * Generate code for binary operations
 */
export function generateBinary<S extends Stack>(
  inst: Ir.Instruction.BinaryOp,
): Transition<S, readonly ["value", ...S]> {
  const debug = inst.operationDebug;

  const map: {
    [O in Ir.Instruction.BinaryOp["op"]]: (
      state: State<readonly ["a", "b", ...S]>,
    ) => State<readonly [Stack.Brand, ...S]>;
  } = {
    add: ADD({ debug }),
    sub: SUB({ debug }),
    mul: MUL({ debug }),
    div: DIV({ debug }),
    mod: MOD({ debug }),
    shl: pipe<readonly ["a", "b", ...S]>()
      .then(rebrand<"a", "shift", "b", "value">({ 1: "shift", 2: "value" }))
      .then(SHL({ debug }))
      .done(),
    shr: pipe<readonly ["a", "b", ...S]>()
      .then(rebrand<"a", "shift", "b", "value">({ 1: "shift", 2: "value" }))
      .then(SHR({ debug }))
      .done(),
    eq: EQ({ debug }),
    ne: pipe<readonly ["a", "b", ...S]>()
      .then(EQ({ debug }), { as: "a" })
      .then(NOT({ debug }))
      .done(),
    lt: LT({ debug }),
    le: pipe<readonly ["a", "b", ...S]>()
      .then(GT({ debug }), { as: "a" })
      .then(NOT({ debug }))
      .done(),
    gt: GT({ debug }),
    ge: pipe<readonly ["a", "b", ...S]>()
      .then(LT({ debug }), { as: "a" })
      .then(NOT({ debug }))
      .done(),
    and: AND({ debug }),
    or: OR({ debug }),
  };

  return pipe<S>()
    .then(loadValue(inst.left, { debug }), { as: "b" })
    .then(loadValue(inst.right, { debug }), { as: "a" })
    .then(map[inst.op], { as: "value" })
    .then(storeValueIfNeeded(inst.dest, { debug }))
    .done();
}
