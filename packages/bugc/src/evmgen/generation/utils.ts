/**
 * Utility functions for EVM generation
 */

import * as Ir from "../../ir";
import type { Stack } from "../../evm";
import {
  type GenState,
  type Transition,
  pipe,
  operations,
} from "../operations";
import { MEMORY_REGIONS } from "../analysis/memory";

/**
 * Get the ID for a value
 */
export function valueId(val: Ir.Value): string {
  if (val.kind === "const") {
    // Constants don't have stable IDs, we'll handle them specially
    return `$const_${val.value}`;
  } else if (val.kind === "temp") {
    return val.id;
  } else {
    return val.name;
  }
}

/**
 * Annotate the top stack item with an IR value
 */
export const annotateTop =
  (irValue: string) =>
  <S extends Stack>(state: GenState<S>): GenState<S> => {
    if (state.stack.length === 0) {
      throw new Error("Cannot annotate empty stack");
    }

    const newStack = [...state.stack];
    newStack[0] = {
      ...newStack[0],
      irValue,
    };

    return {
      ...state,
      stack: newStack,
    };
  };

/**
 * Load a value onto the stack, handling constants, stack values, and memory
 */
export const loadValue = <S extends Stack>(
  value: Ir.Value,
): Transition<S, readonly ["value", ...S]> => {
  const { PUSHn, DUPn, MLOAD } = operations;

  const id = valueId(value);

  if (value.kind === "const") {
    return pipe<S>()
      .then(PUSHn(BigInt(value.value)))
      .then(annotateTop(id))
      .done();
  }

  return pipe<S>()
    .peek((state, builder) => {
      // Check if value is on stack
      // Note addition because DUP uses 1-based indexing
      const stackPos =
        state.stack.findIndex(({ irValue }) => irValue === id) + 1;
      if (stackPos > 0 && stackPos <= 16) {
        return builder.then(DUPn(stackPos), { as: "value" });
      }
      // Check if in memory
      if (id in state.memory.allocations) {
        const offset = state.memory.allocations[id].offset;
        return builder
          .then(PUSHn(BigInt(offset)), { as: "offset" })
          .then(MLOAD())
          .then(annotateTop(id));
      }

      throw new Error(`Cannot load value ${id} - not in stack or memory`);
    })
    .done();
};

/**
 * Store a value to memory if it has an allocation
 */
export const storeValueIfNeeded = <S extends Stack>(
  destId: string,
): Transition<readonly ["value", ...S], readonly ["value", ...S]> => {
  const { PUSHn, DUP2, SWAP1, MSTORE } = operations;

  return (
    pipe<readonly ["value", ...S]>()
      // First annotate the top value with the destination ID
      .then(annotateTop(destId))
      .peek((state, builder) => {
        const allocation = state.memory.allocations[destId];
        if (allocation === undefined) {
          return builder;
        }
        return builder
          .then(PUSHn(BigInt(allocation.offset)), { as: "offset" })
          .then(DUP2())
          .then(SWAP1())
          .then(MSTORE());
      })
      .done()
  );
};

/**
 * Allocate memory dynamically at runtime
 * Loads the free memory pointer, returns it, and updates it
 *
 * Stack: [...] -> [allocatedOffset, ...]
 *
 * Note: This is a simplified version. A proper implementation would
 * need to handle stack types more carefully.
 */
export function allocateMemory<S extends Stack>(
  sizeBytes: bigint,
): Transition<S, readonly ["offset", ...S]> {
  const { PUSHn } = operations;

  return (
    pipe<S>()
      .then(PUSHn(sizeBytes), { as: "size" })
      .then(allocateMemoryDynamic())
      .done()
  );
}

/**
 * Allocate memory dynamically with size on the stack
 * Takes size from stack, allocates memory, returns allocated offset
 *
 * Stack: [size, ...] -> [allocatedOffset, ...]
 */
export function allocateMemoryDynamic<S extends Stack>(): Transition<
  readonly ["size", ...S],
  readonly ["offset", ...S]
> {
  const { PUSHn, SWAP1, DUP2, MLOAD, ADD, MSTORE } = operations;

  return pipe<readonly ["size", ...S]>()
    // Load current free memory pointer from 0x40
    .then(PUSHn(BigInt(MEMORY_REGIONS.FREE_MEMORY_POINTER)), { as: "offset" })
    .then(MLOAD(), { as: "offset" })
    .then(SWAP1(), { as: "b" })
    // Stack: [size, current_fmp, ...]
    // Save current for return, calculate new = current + size
    .then(DUP2(), { as: "a" })
    // Stack: [current_fmp, size, current_fmp, ...]
    .then(ADD(), { as: "value" })
    // Stack: [new_fmp, current_fmp, ...]

    // Store new free pointer
    .then(PUSHn(BigInt(MEMORY_REGIONS.FREE_MEMORY_POINTER)), { as: "offset" })
    .then(MSTORE())
    // Stack: [current_fmp(allocated), ...]
    .done();
}


