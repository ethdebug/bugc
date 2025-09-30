import type * as Ir from "#ir";
import type { Stack } from "#evm";

import { type Transition, rebrand, pipe, operations } from "#evmgen/operations";

import { loadValue, storeValueIfNeeded } from "../values/index.js";

const {
  SWAP1,
  PUSHn,
  SLOAD,
  SSTORE,
  MLOAD,
  MSTORE,
  SHL,
  SHR,
  AND,
  OR,
  NOT,
  SUB,
  DUP1,
} = operations;

/**
 * Generate code for the new unified read instruction
 */
export function generateRead<S extends Stack>(
  inst: Ir.Instruction.Read,
): Transition<S, readonly ["value", ...S]> {
  // Handle storage reads
  if (inst.location === "storage" && inst.slot) {
    const offset = inst.offset?.kind === "const" ? inst.offset.value : 0n;
    const length = inst.length?.kind === "const" ? inst.length.value : 32n;

    if (offset === 0n && length === 32n) {
      // Full slot read - simple SLOAD
      return pipe<S>()
        .then(loadValue(inst.slot), { as: "key" })
        .then(SLOAD(), { as: "value" })
        .then(storeValueIfNeeded(inst.dest))
        .done();
    } else {
      // Partial read - need to extract specific bytes
      return (
        pipe<S>()
          .then(loadValue(inst.slot), { as: "key" })
          .then(SLOAD(), { as: "value" })

          // Shift right to move desired bytes to the right (low) end
          // We shift by (32 - offset - length) * 8 bits
          .then(PUSHn((32n - BigInt(offset) - BigInt(length)) * 8n), {
            as: "shift",
          })
          .then(SHR(), { as: "shiftedValue" })
          .then(PUSHn(1n), { as: "b" })

          // Mask to keep only the desired length
          // mask = (1 << (length * 8)) - 1
          .then(PUSHn(1n), { as: "value" })
          .then(PUSHn(BigInt(length) * 8n), { as: "shift" })
          .then(SHL(), { as: "a" }) // (1 << (length * 8))
          .then(SUB(), { as: "mask" }) // ((1 << (length * 8)) - 1)
          .then(rebrand<"mask", "a", "shiftedValue", "b">({ 1: "a", 2: "b" }))

          // Apply mask: shiftedValue & mask
          .then(AND(), { as: "value" })
          .then(storeValueIfNeeded(inst.dest))
          .done()
      );
    }
  }

  // Handle memory reads
  if (inst.location === "memory" && inst.offset) {
    return pipe<S>()
      .then(loadValue(inst.offset), { as: "offset" })
      .then(MLOAD(), { as: "value" })
      .then(storeValueIfNeeded(inst.dest))
      .done();
  }

  // TODO: Handle other locations (calldata, returndata)
  // For unsupported locations, push a dummy value to maintain stack typing
  return pipe<S>().then(PUSHn(0n), { as: "value" }).done();
}

/**
 * Generate code for the new unified write instruction
 */
export function generateWrite<S extends Stack>(
  inst: Ir.Instruction.Write,
): Transition<S, S> {
  // Handle storage writes
  if (inst.location === "storage" && inst.slot && inst.value) {
    // Check if this is a partial write (offset != 0 or length != 32)
    const offset = inst.offset?.kind === "const" ? inst.offset.value : 0n;
    const length = inst.length?.kind === "const" ? inst.length.value : 32n;

    if (offset === 0n && length === 32n) {
      // Full slot write - simple SSTORE
      return pipe<S>()
        .then(loadValue(inst.value), { as: "value" })
        .then(loadValue(inst.slot), { as: "key" })
        .then(SSTORE())
        .done();
    } else {
      // Partial write - need to do read-modify-write with masking
      return (
        pipe<S>()
          // Load the slot key and duplicate for later SSTORE
          .then(loadValue(inst.slot), { as: "key" })
          .then(DUP1())

          // Load current value from storage
          .then(SLOAD(), { as: "current" })

          // Create mask to clear the bits we're updating
          // First create: (1 << (length * 8)) - 1
          .then(PUSHn(1n), { as: "b" })
          .then(PUSHn(1n), { as: "value" })
          .then(PUSHn(BigInt(length) * 8n), { as: "shift" })
          .then(SHL(), { as: "a" }) // (1 << (length * 8))
          .then(SUB(), { as: "lengthMask" }) // ((1 << (length * 8)) - 1)

          // Then shift it left by offset: ((1 << (length * 8)) - 1) << (offset * 8)
          .then(PUSHn(BigInt(offset) * 8n), { as: "bitOffset" })
          .then(
            rebrand<"bitOffset", "shift", "lengthMask", "value">({
              1: "shift",
              2: "value",
            }),
          )
          .then(SHL(), { as: "a" })

          // Invert to get clear mask: ~(((1 << (length * 8)) - 1) << (offset * 8))
          .then(NOT(), { as: "clearMask" })
          .then(rebrand<"clearMask", "a", "current", "b">({ 1: "a", 2: "b" }))

          // Clear the bits in the current value: current & clearMask
          .then(AND(), { as: "clearedCurrent" })

          // Prepare the new value (shift to correct position)
          .then(loadValue(inst.value), { as: "value" })
          .then(PUSHn(BigInt(offset) * 8n), { as: "shift" })
          .then(SHL(), { as: "shiftedValue" })

          .then(
            rebrand<"shiftedValue", "a", "clearedCurrent", "b">({
              1: "a",
              2: "b",
            }),
          )

          // Combine: clearedCurrent | shiftedValue
          .then(OR(), { as: "value" })
          .then(SWAP1())

          // Store the result (key is already on stack from DUP1)
          .then(SSTORE())
          .done()
      );
    }
  }

  // Handle memory writes
  if (inst.location === "memory" && inst.offset && inst.value) {
    return pipe<S>()
      .then(loadValue(inst.value), { as: "value" })
      .then(loadValue(inst.offset), { as: "offset" })
      .then(MSTORE())
      .done();
  }

  // TODO: Handle other locations
  return (state) => state;
}
