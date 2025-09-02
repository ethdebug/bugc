/**
 * Utility functions for EVM generation
 */

import * as Ir from "../../ir";
import type { Stack } from "../../evm";
import { type GenState, rebrandTop, operations } from "../operations";

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
export function annotateTop<S extends Stack>(
  state: GenState<S>,
  irValue: string,
): GenState<S> {
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
}

/**
 * Load a value onto the stack, handling constants, stack values, and memory
 */
export function loadValue<S extends Stack>(
  state: GenState<S>,
  value: Ir.Value,
): GenState<readonly ["value", ...S]> {
  const id = valueId(value);

  if (value.kind === "const") {
    // Push constant directly and annotate it
    const newState = operations.PUSHn(state, BigInt(value.value));
    return annotateTop(newState, id);
  }

  // Check if value is on stack
  // Note addition because DUP uses 1-based indexing
  const stackPos = state.stack.findIndex(({ irValue }) => irValue === id) + 1;
  if (stackPos > 0 && stackPos <= 16) {
    // Cast is safe - we know DUP produces an item and we're rebranding it to "value"
    return rebrandTop(operations.DUPn(state, stackPos), "value");
  }

  // Check if in memory
  if (id in state.memory.allocations) {
    const offset = state.memory.allocations[id].offset;
    const s1 = operations.PUSHn(state, BigInt(offset), { brand: "offset" });
    const s2 = operations.MLOAD(s1);
    // Annotate the loaded value
    return annotateTop(s2, id);
  }

  throw new Error(`Cannot load value ${id} - not in stack or memory`);
}

/**
 * Store a value to memory if it has an allocation
 */
export function storeValueIfNeeded<S extends Stack>(
  state: GenState<readonly ["value", ...S]>,
  destId: string,
): GenState<readonly ["value", ...S]> {
  // First annotate the top value with the destination ID
  const s0 = annotateTop(state, destId);

  const allocation = state.memory.allocations[destId];
  if (allocation === undefined) {
    return s0;
  }

  const s1 = operations.PUSHn(s0, BigInt(allocation.offset), { brand: "offset" });
  const s2 = operations.DUP2(s1);
  const s3 = operations.SWAP1(s2);
  return operations.MSTORE(s3);
}
