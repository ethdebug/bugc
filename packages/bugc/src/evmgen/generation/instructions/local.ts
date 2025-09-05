import type * as Ir from "#ir";
import type { Stack } from "#evm";
import type { Transition } from "../../operations/index.js";
import { pipe, operations } from "../../operations/index.js";
import { loadValue, storeValueIfNeeded } from "../values/index.js";
import { allocateMemoryDynamic } from "../memory/index.js";
import { EvmError, EvmErrorCode } from "../../errors.js";

const { PUSHn, MLOAD, MSTORE, DUP2, ADD } = operations;

/**
 * Generate code for loading from local memory
 */
export function generateLoadLocal<S extends Stack>(
  inst: Ir.LoadLocalInstruction,
): Transition<S, readonly ["value", ...S]> {
  return pipe<S>()
    .peek((state, builder) => {
      const allocation = state.memory.allocations[inst.local];
      if (allocation === undefined) {
        throw new EvmError(
          EvmErrorCode.MEMORY_ALLOCATION_FAILED,
          `Local ${inst.local} not allocated in memory`,
        );
      }

      return builder
        .then(PUSHn(BigInt(allocation.offset)), { as: "offset" })
        .then(MLOAD())
        .then(storeValueIfNeeded(inst.dest));
    })
    .done();
}

/**
 * Generate code for storing to local memory
 */
export function generateStoreLocal<S extends Stack>(
  inst: Ir.StoreLocalInstruction,
): Transition<S, S> {
  return pipe<S>()
    .peek((state, builder) => {
      const allocation = state.memory.allocations[inst.local];
      if (allocation === undefined) {
        throw new EvmError(
          EvmErrorCode.MEMORY_ALLOCATION_FAILED,
          `Local ${inst.local} not allocated in memory`,
        );
      }

      // Check if we need type conversion from fixed bytes to dynamic bytes
      const isDynamicLocal =
        inst.localType.kind === "bytes" && inst.localType.size === undefined;
      const isFixedValue =
        inst.value.type.kind === "bytes" && inst.value.type.size !== undefined;

      if (isDynamicLocal && isFixedValue && inst.value.type.kind === "bytes") {
        // Need to convert fixed bytes to dynamic bytes format
        // Dynamic bytes format: [ptr] -> [length][data...]
        const fixedSize = inst.value.type.size!;

        return (
          builder
            // Allocate memory for dynamic bytes (32 bytes for length + actual data)
            .then(PUSHn(32n + BigInt(fixedSize)), { as: "size" })
            .then(allocateMemoryDynamic(), { as: "value" }) // Will be the pointer we store

            // Store the length at the allocated offset
            .then(PUSHn(BigInt(fixedSize)), { as: "value" })
            .then(DUP2(), { as: "offset" }) // Duplicate the allocated pointer
            .then(MSTORE())
            // Stack: [pointer, ...]

            // Store the actual bytes data after the length
            .then(loadValue(inst.value), { as: "value" })
            .then(DUP2(), { as: "b" }) // Duplicate pointer again
            .then(PUSHn(32n), { as: "a" })
            .then(ADD(), { as: "offset" })
            .then(MSTORE())
            // Stack: [pointer, ...]

            // Store the pointer to the dynamic bytes at the local's allocation
            .then(PUSHn(BigInt(allocation.offset)), { as: "offset" })
            // Stack: [offset, pointer, ...]
            .then(MSTORE())
        );
      }

      // Normal store without conversion
      return builder
        .then(loadValue(inst.value))
        .then(PUSHn(BigInt(allocation.offset)), { as: "offset" })
        .then(MSTORE());
    })
    .done();
}
