import type * as Ir from "../../../ir";
import type { Stack } from "../../../evm";
import type { Transition } from "../../operations";
import { pipe, operations, rebrandTop } from "../../operations";
import { storeValueIfNeeded } from "../values";
import { allocateMemory } from "../memory";

const { PUSHn, DUP2, MSTORE, ADD } = operations;

/**
 * Generate code for const instructions
 */
export function generateConst<S extends Stack>(
  inst: Ir.ConstInstruction,
): Transition<S, readonly ["value", ...S]> {
  // Check the type to determine how to handle the constant
  // Fixed-size bytes are stored as values on the stack
  if (inst.type.kind === "bytes" && inst.type.size !== undefined) {
    // Fixed-size bytes - just push the value
    let value: bigint;
    if (typeof inst.value === "string" && inst.value.startsWith("0x")) {
      // It's a hex string, convert to bigint
      value = BigInt(inst.value);
    } else if (typeof inst.value === "bigint") {
      value = inst.value;
    } else {
      value = BigInt(inst.value);
    }
    return pipe<S>()
      .then(PUSHn(value))
      .then(storeValueIfNeeded(inst.dest))
      .done();
  }

  // Dynamic bytes and strings need memory allocation
  if (
    inst.type.kind === "string" ||
    (inst.type.kind === "bytes" && inst.type.size === undefined)
  ) {
    let bytes: Uint8Array;
    let byteLength: bigint;

    if (
      inst.type.kind === "bytes" &&
      typeof inst.value === "string" &&
      inst.value.startsWith("0x")
    ) {
      // Dynamic bytes from hex string - decode the hex
      const hexStr = inst.value.slice(2); // Remove 0x prefix
      const hexBytes = [];
      for (let i = 0; i < hexStr.length; i += 2) {
        hexBytes.push(parseInt(hexStr.substr(i, 2), 16));
      }
      bytes = new Uint8Array(hexBytes);
      byteLength = BigInt(bytes.length);
    } else {
      // String or non-hex bytes - use UTF-8 encoding
      const strValue = String(inst.value);
      const encoder = new TextEncoder();
      bytes = encoder.encode(strValue);
      byteLength = BigInt(bytes.length);
    }

    // Calculate memory needed: 32 bytes for length + actual data (padded to 32-byte words)
    const dataWords = (byteLength + 31n) / 32n;
    const totalBytes = 32n + dataWords * 32n;

    // String/bytes constants need to be stored in memory
    return (
      pipe<S>()
        // Allocate memory dynamically
        .then(allocateMemory(totalBytes), { as: "offset" })

        // Store the length at the allocated offset
        .then(PUSHn(BigInt(byteLength)), { as: "value" })
        .then(DUP2(), { as: "offset" })
        .then(MSTORE())
        .peek((_, builder) => {
          let result = builder;

          // Store the actual bytes
          // For simplicity, we'll pack bytes into 32-byte words
          for (let wordIdx = 0n; wordIdx < dataWords; wordIdx++) {
            const wordStart = wordIdx * 32n;
            const wordEnd =
              byteLength < wordStart + 32n ? byteLength : wordStart + 32n;

            // Pack up to 32 bytes into a single word
            let wordValue = 0n;
            for (let i = wordStart; i < wordEnd; i++) {
              // Shift left and add the byte (big-endian)
              wordValue = (wordValue << 8n) | BigInt(bytes[Number(i)]);
            }

            // Pad remaining bytes with zeros (already done by shifting)
            const remainingBytes = 32n - (wordEnd - wordStart);
            wordValue = wordValue << (remainingBytes * 8n);

            // Store the word at offset + 32 + (wordIdx * 32)
            const storeOffset = 32n + wordIdx * 32n;
            result = result
              .then(PUSHn(wordValue), { as: "value" })
              .then(DUP2(), { as: "b" })
              .then(PUSHn(storeOffset), { as: "a" })
              .then(ADD(), { as: "offset" })
              .then(MSTORE());
          }

          // The original offset is still on the stack (from DUP2 operations)
          // Rebrand it as value for return
          return result
            .then(rebrandTop("value"))
            .then(storeValueIfNeeded(inst.dest));
        })
        .done()
    );
  }

  // For numeric and boolean constants, use existing behavior
  return pipe<S>()
    .then(PUSHn(BigInt(inst.value)))
    .then(storeValueIfNeeded(inst.dest))
    .done();
}
