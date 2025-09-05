import type * as Ir from "../../../ir";
import type { Stack } from "../../../evm";
import type { Transition } from "../../operations";
import { pipe, operations } from "../../operations";
import { loadValue, storeValueIfNeeded, valueId } from "../values";
import { EvmError, EvmErrorCode } from "../../errors";

const { PUSHn, CALLDATASIZE, SLOAD, MLOAD, SUB, SHR } = operations;

/**
 * Generate code for length operations
 */
export function generateLength<S extends Stack>(
  inst: Ir.LengthInstruction,
): Transition<S, readonly ["value", ...S]> {
  // Check if this is msg.data (calldata) - use CALLDATASIZE
  const objectId = valueId(inst.object);
  const isCalldata =
    objectId.includes("calldata") ||
    objectId.includes("msg_data") ||
    objectId.includes("msg.data");

  if (isCalldata) {
    return pipe<S>()
      .then(CALLDATASIZE(), { as: "value" })
      .then(storeValueIfNeeded(inst.dest))
      .done();
  }

  // Length instruction - behavior depends on the type
  const objectType = inst.object.type;

  if (objectType.kind === "array") {
    if (objectType.size !== undefined) {
      // Fixed-size array - return the size
      return pipe<S>()
        .then(PUSHn(BigInt(objectType.size)))
        .then(storeValueIfNeeded(inst.dest))
        .done();
    } else {
      // Dynamic array - length is stored at the slot
      return pipe<S>()
        .then(loadValue(inst.object), { as: "key" })
        .then(SLOAD())
        .then(storeValueIfNeeded(inst.dest))
        .done();
    }
  }

  if (objectType.kind === "bytes") {
    if (objectType.size !== undefined) {
      // Fixed-size bytes - return the size
      return pipe<S>()
        .then(PUSHn(BigInt(objectType.size)))
        .then(storeValueIfNeeded(inst.dest))
        .done();
    } else {
      // Dynamic bytes - need to check if in memory or storage
      return pipe<S>()
        .peek((state, builder) => {
          // Check if value is in memory
          const isInMemory =
            objectId in state.memory.allocations ||
            state.stack.findIndex(({ irValue }) => irValue === objectId) > -1;

          if (isInMemory) {
            // Memory bytes: length is stored at the pointer location
            // First word contains length (in bytes)
            return builder
              .then(loadValue(inst.object), { as: "offset" })
              .then(MLOAD(), { as: "value" })
              .then(storeValueIfNeeded(inst.dest));
          } else {
            // Storage bytes: length is packed with data if short, or in slot if long
            // For simplicity, assume it's stored at the slot (long string/bytes)
            // The length is stored as 2 * length + 1 in the slot for long strings
            return (
              builder
                .then(loadValue(inst.object), { as: "key" })
                .then(SLOAD(), { as: "b" })
                // Extract length from storage format
                // For long strings: (value - 1) / 2
                .then(PUSHn(1n), { as: "a" })
                .then(SUB(), { as: "value" })
                .then(PUSHn(1n), { as: "shift" })
                .then(SHR(), { as: "value" })
                .then(storeValueIfNeeded(inst.dest))
            );
          }
        })
        .done();
    }
  }

  if (objectType.kind === "string") {
    // Strings work the same as dynamic bytes
    return pipe<S>()
      .peek((state, builder) => {
        // Check if value is in memory
        const isInMemory =
          objectId in state.memory.allocations ||
          state.stack.findIndex(({ irValue }) => irValue === objectId) > -1;

        if (isInMemory) {
          // Memory string: length is stored at the pointer location
          return builder
            .then(loadValue(inst.object), { as: "offset" })
            .then(MLOAD(), { as: "value" })
            .then(storeValueIfNeeded(inst.dest));
        } else {
          // Storage string: same as storage bytes
          return (
            builder
              .then(loadValue(inst.object), { as: "key" })
              .then(SLOAD(), { as: "b" })
              // Extract length from storage format
              .then(PUSHn(1n), { as: "a" })
              .then(SUB(), { as: "value" })
              .then(PUSHn(1n), { as: "shift" })
              .then(SHR(), { as: "value" })
              .then(storeValueIfNeeded(inst.dest))
          );
        }
      })
      .done();
  }

  throw new EvmError(
    EvmErrorCode.UNSUPPORTED_INSTRUCTION,
    `length operation not supported for type: ${objectType.kind}`,
  );
}
