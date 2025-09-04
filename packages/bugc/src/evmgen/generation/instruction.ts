/**
 * IR instruction code generation
 */

import * as Ir from "../../ir";
import type { Stack, StackBrand } from "../../evm";
import { EvmError, EvmErrorCode } from "../errors";
import { Severity } from "../../result";
import {
  type GenState,
  type Transition,
  pipe,
  rebrandTop,
  operations,
} from "../operations";
import {
  loadValue,
  storeValueIfNeeded,
  allocateMemoryDynamic,
  getArrayElementSize,
  valueId,
} from "./utils";

const {
  ADD,
  AND,
  CALLDATACOPY,
  CALLDATASIZE,
  CALLER,
  CALLVALUE,
  DIV,
  DUP1,
  DUP2,
  EQ,
  GT,
  KECCAK256,
  LT,
  MCOPY,
  MLOAD,
  MOD,
  MSTORE,
  MUL,
  NOT,
  NUMBER,
  OR,
  PUSH0,
  PUSHn,
  SHR,
  SLOAD,
  SSTORE,
  SUB,
  SWAP1,
  SWAP3,
  TIMESTAMP,
} = operations;

/**
 * Generate code for a single IR instruction
 */
export function generateInstruction<S extends Stack>(
  inst: Ir.IrInstruction,
): Transition<S, Stack> {
  switch (inst.kind) {
    case "const":
      return generateConst(inst);
    case "binary":
      return generateBinary(inst);
    case "unary":
      return generateUnary(inst);
    case "load_storage":
      return generateLoadStorage(inst);
    case "store_storage":
      return generateStoreStorage(inst);
    case "load_mapping":
      return generateLoadMapping(inst);
    case "store_mapping":
      return generateStoreMapping(inst);
    case "load_local":
      return generateLoadLocal(inst);
    case "store_local":
      return generateStoreLocal(inst);
    case "env":
      return generateEnvOp(inst);
    case "hash":
      return generateHashOp(inst);
    case "length":
      return generateLength(inst);
    case "compute_slot":
      return generateComputeSlot(inst);
    case "compute_array_slot":
      return generateComputeArraySlot(inst);
    case "cast":
      return generateCast(inst);
    case "slice":
      return generateSlice(inst);
    default: {
      return (state) => {
        // Add warning for unsupported instructions
        const warning = new EvmError(
          EvmErrorCode.UNSUPPORTED_INSTRUCTION,
          inst.kind,
          inst.loc,
          Severity.Warning,
        );
        return {
          ...state,
          warnings: [...state.warnings, warning],
        };
      };
    }
  }
}

/**
 * Generate a binary operation
 */
export function generateBinary<S extends Stack>(
  inst: Ir.BinaryOpInstruction,
): Transition<S, readonly ["value", ...S]> {
  const map: {
    [O in Ir.BinaryOp]: (
      state: GenState<readonly ["a", "b", ...S]>,
    ) => GenState<readonly [StackBrand, ...S]>;
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

/**
 * Generate a unary operation
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

/**
 * Generate a const instruction
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
  if (inst.type.kind === "string" || (inst.type.kind === "bytes" && inst.type.size === undefined)) {
    let bytes: Uint8Array;
    let byteLength: bigint;

    if (inst.type.kind === "bytes" && typeof inst.value === "string" && inst.value.startsWith("0x")) {
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
        .then(PUSHn(totalBytes), { as: "size" })
        .then(allocateMemoryDynamic(), { as: "offset" })

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

/**
 * Generate local load
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
 * Generate local store
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
      const isDynamicLocal = inst.localType.kind === "bytes" &&
        inst.localType.size === undefined;
      const isFixedValue = inst.value.type.kind === "bytes" &&
        inst.value.type.size !== undefined;

      if (isDynamicLocal && isFixedValue && inst.value.type.kind === "bytes") {
        // Need to convert fixed bytes to dynamic bytes format
        // Dynamic bytes format: [ptr] -> [length][data...]
        const fixedSize = inst.value.type.size!;

        return builder
          // Allocate memory for dynamic bytes (32 bytes for length + actual data)
          .then(PUSHn(32n + BigInt(fixedSize)), { as: "size" })
          .then(allocateMemoryDynamic(), { as: "value" })  // Will be the pointer we store

          // Store the length at the allocated offset
          .then(PUSHn(BigInt(fixedSize)), { as: "value" })
          .then(DUP2(), { as: "offset" })  // Duplicate the allocated pointer
          .then(MSTORE())
          // Stack: [pointer, ...]

          // Store the actual bytes data after the length
          .then(loadValue(inst.value), { as: "value" })
          .then(DUP2(), { as: "b" })  // Duplicate pointer again
          .then(PUSHn(32n), { as: "a" })
          .then(ADD(), { as: "offset" })
          .then(MSTORE())
          // Stack: [pointer, ...]

          // Store the pointer to the dynamic bytes at the local's allocation
          .then(PUSHn(BigInt(allocation.offset)), { as: "offset" })
          // Stack: [offset, pointer, ...]
          .then(MSTORE());
      }

      // Normal store without conversion
      return builder
        .then(loadValue(inst.value))
        .then(PUSHn(BigInt(allocation.offset)), { as: "offset" })
        .then(MSTORE());
    })
    .done();
}

/**
 * Generate storage load
 */
export function generateLoadStorage<S extends Stack>(
  inst: Ir.LoadStorageInstruction,
): Transition<S, readonly ["value", ...S]> {

  return pipe<S>()
    .then(loadValue(inst.slot), { as: "key" })
    .then(SLOAD(), { as: "value" })
    .then(storeValueIfNeeded(inst.dest))
    .done();
}

/**
 * Generate storage store
 */
function generateStoreStorage<S extends Stack>(
  inst: Ir.StoreStorageInstruction,
): Transition<S, S> {

  return pipe<S>()
    .then(loadValue(inst.value), { as: "value" })
    .then(loadValue(inst.slot), { as: "key" })
    .then(SSTORE())
    .done();
}

/**
 * Generate environment operations
 */
function generateEnvOp<S extends Stack>(
  inst: Ir.EnvInstruction,
): Transition<S, readonly ["value", ...S]> {
  const map: {
    [O in Ir.EnvOp]: <S extends Stack>(
      state: GenState<readonly [...S]>,
    ) => GenState<readonly [StackBrand, ...S]>;
  } = {
    msg_sender: CALLER(),
    msg_value: CALLVALUE(),
    msg_data: PUSH0(), // Returns calldata offset (0)
    block_timestamp: TIMESTAMP(),
    block_number: NUMBER(),
  };

  return pipe<S>()
    .then(map[inst.op], { as: "value" })
    .then(storeValueIfNeeded(inst.dest))
    .done();
}

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

function generateHashOp<S extends Stack>(
  inst: Ir.HashInstruction,
): Transition<S, readonly ["value", ...S]> {
  return pipe<S>()
    .then(loadValue(inst.value))
    .then(PUSHn(0n), { as: "offset" })
    .then(MSTORE())
    .then(PUSHn(32n), { as: "size" })
    .then(PUSHn(0n), { as: "offset" })
    .then(KECCAK256(), { as: "value" })
    .then(storeValueIfNeeded(inst.dest))
    .done();
}

function generateComputeSlot<S extends Stack>(
  inst: Ir.ComputeSlotInstruction,
): Transition<S, readonly ["value", ...S]> {
  return (
    pipe<S>()
      // store key then baseSlot in memory as 32 bytes each
      .then(loadValue(inst.key))
      .then(PUSHn(0n), { as: "offset" })
      .then(MSTORE())

      .then(loadValue(inst.baseSlot))
      .then(PUSHn(32n), { as: "offset" })
      .then(MSTORE())
      .then(PUSHn(64n), { as: "size" })
      .then(PUSHn(0n), { as: "offset" })
      .then(KECCAK256(), { as: "value" })
      .then(storeValueIfNeeded(inst.dest))
      .done()
  );
}

function generateComputeArraySlot<S extends Stack>(
  inst: Ir.ComputeArraySlotInstruction,
): Transition<S, readonly ["value", ...S]> {
  // For arrays: keccak256(baseSlot)
  return (
    pipe<readonly [...S]>()
      // Store baseSlot at memory offset 0
      .then(loadValue(inst.baseSlot))
      .then(PUSHn(0n), { as: "offset" })
      .then(MSTORE())

      // Hash 32 bytes starting at offset 0
      .then(PUSHn(32n), { as: "size" })
      .then(PUSHn(0n), { as: "offset" })
      .then(KECCAK256(), { as: "value" })
      .then(storeValueIfNeeded(inst.dest))
      .done()
  );
}

/**
 * Generate code for cast instruction (type conversion)
 */
function generateCast<S extends Stack>(
  inst: Ir.CastInstruction,
): Transition<S, readonly ["value", ...S]> {
  // Cast is a no-op at the EVM level since types are checked at compile time
  // Just load the value and store it with the new type annotation
  return pipe<S>()
    .then(loadValue(inst.value), { as: "value" })
    .then(storeValueIfNeeded(inst.dest))
    .done();
}

/**
 * Generate code for slice instruction
 * Creates a new memory region containing elements from start to end
 */
function generateSlice<S extends Stack>(
  inst: Ir.SliceInstruction,
): Transition<S, readonly ["value", ...S]> {
  // For bytes/strings, each element is 1 byte. For arrays, use the element size.
  const elementSize =
    inst.object.type.kind === "bytes" || inst.object.type.kind === "string"
      ? 1n
      : getArrayElementSize(inst.object.type);

  // For storage arrays, we need to:
  // 1. Compute the base storage slot (compute_array_slot gives us keccak256(slot))
  // 2. For each element from start to end:
  //    - Add the index to the base slot
  //    - Load from storage
  //    - Store to memory

  // For memory arrays, we can use MCOPY directly
  // For calldata arrays, we can use CALLDATACOPY

  // We'll check if the value came from a compute_array_slot by checking
  // if it's already in memory allocations. If not, we need to determine
  // if it's storage or calldata.

  return pipe<S>()
    .peek((state, builder) => {
      const objectId = valueId(inst.object);
      const isInMemory =
        objectId in state.memory.allocations ||
        state.stack.findIndex(({ irValue }) => irValue === objectId) > -1;

      // Check if it's calldata by looking at the value id pattern
      // Calldata values typically come from msg_data or function arguments
      const isCalldata =
        objectId.includes("calldata") ||
        objectId.includes("msg_data") ||
        objectId.includes("msg.data");

      if (!isInMemory && !isCalldata) {
        // Storage array - need to load each element
        // This is more complex, so for now we'll implement the memory case
        // and add a warning for storage arrays
        return builder
          .then((s) => {
            const warning = new EvmError(
              EvmErrorCode.UNSUPPORTED_INSTRUCTION,
              "Slice of storage arrays not yet implemented",
              inst.loc,
              Severity.Warning,
            );
            return {
              ...s,
              warnings: [...s.warnings, warning],
            };
          })
          .then(PUSHn(0n), { as: "value" }) // Placeholder
          .then(storeValueIfNeeded(inst.dest));
      }

      // Common logic for calculating slice parameters
      const sliceBuilder = builder
        .then(loadValue(inst.start), { as: "start" })
        .then(loadValue(inst.end), { as: "end" })
        // Stack: [end, start, ...]

        // Calculate length = end - start
        .then(DUP2(), { as: "b" })
        // Stack: [start, end, start, ...]
        .then(SWAP1(), { as: "a" })
        // Stack: [end, start, start, ...]
        .then(SUB(), { as: "b" })
        // Stack: [count, start, ...]

        // Calculate byte size = length * element_size
        .then(PUSHn(elementSize), { as: "a" })
        // Stack: [itemSize, count, start, ...]
        .then(MUL(), { as: "size" })
        // Stack: [bytesSize, start, ...]

        // save total bytes size because it's needed for copy
        .then(DUP1())
        // Stack: [bytesSize, bytesSize, start, ...]

        // Allocate memory dynamically
        .then(allocateMemoryDynamic(), { as: "destOffset" })
        // Stack: [destOffset, bytesSize, start, ...]

        // Save destOffset for return value
        .then(DUP1());
      // Stack: [destOffset, destOffset, bytesSize, start, ...];

      if (isCalldata) {
        // Calldata array implementation using CALLDATACOPY
        return (
          sliceBuilder
            // Stack: [destOffset, destOffset, bytesSize, start, ...]

            // and grab start now to calculate calldata offset
            .then(SWAP3(), { as: "b" })
            // Stack: [start, destOffset, bytesSize, destOffset, ...]

            .then(PUSHn(elementSize), { as: "a" })
            .then(MUL(), { as: "b" })

            // load the calldata offset of the array
            .then(loadValue(inst.object), { as: "a" })
            // add the computed size before the slice to get
            // the starting offset in calldata
            .then(ADD(), { as: "offset" })

            // Stack needs to be [destOffset, offset, size] for CALLDATACOPY
            .then(SWAP1())
            // Stack: [destOffset, offset, bytesSize, destOffset, ...]
            .then(CALLDATACOPY())

            // only relevant item left on stack is the offset of the newly
            // allocated memory.
            .then(rebrandTop("value"))
            .then(storeValueIfNeeded(inst.dest))
        );
      } else {
        // Memory array implementation using MCOPY
        // Check if we need to skip the length field for dynamic bytes
        const isDynamicBytes = inst.object.type.kind === "bytes" &&
          inst.object.type.size === undefined;

        let memBuilder = sliceBuilder
          // and grab start now since we won't need this new destOffset for awhile
          // this will be multiplied by the element size
          .then(SWAP3(), { as: "b" })
          // Stack: [start, destOffset, bytesSize, destOffset, ...]

          .then(PUSHn(elementSize), { as: "a" })
          .then(MUL(), { as: "b" })

          // load the pointer to the start of the sliced object
          .then(loadValue(inst.object), { as: "a" })
          .then(ADD(), { as: "offset" });

        // For dynamic bytes/strings, we need to skip the length field (32 bytes)
        // to get to the actual data
        if (isDynamicBytes) {
          memBuilder = memBuilder
            .then(rebrandTop("b"))
            .then(PUSHn(32n), { as: "a" })
            .then(ADD(), { as: "offset" });
        }

        return memBuilder
          // re-order for MCOPY
          .then(SWAP1())
          .then(MCOPY())

          // only relevant item left on stack is the offset of the newly
          // allocated memory.
          .then(rebrandTop("value"))
          .then(storeValueIfNeeded(inst.dest));
      }
    })
    .done();
}

/**
 * Generate code for loading from a mapping
 * Computes storage slot as keccak256(key . slot) and loads the value
 */
function generateLoadMapping<S extends Stack>(
  inst: Ir.LoadMappingInstruction,
): Transition<S, readonly ["value", ...S]> {
  return (
    pipe<S>()
      // Store key at scratch space offset 0
      .then(loadValue(inst.key))
      .then(PUSHn(0n), { as: "offset" })
      .then(MSTORE())

      // Store mapping slot at scratch space offset 32
      .then(PUSHn(BigInt(inst.slot)))
      .then(PUSHn(32n), { as: "offset" })
      .then(MSTORE())

      // Hash 64 bytes to get storage location: keccak256(key . slot)
      .then(PUSHn(64n), { as: "size" })
      .then(PUSHn(0n), { as: "offset" })
      .then(KECCAK256(), { as: "key" })

      // Load value from computed storage slot
      .then(SLOAD(), { as: "value" })
      .then(storeValueIfNeeded(inst.dest))
      .done()
  );
}

/**
 * Generate code for storing to a mapping
 * Computes storage slot as keccak256(key . slot) and stores the value
 */
function generateStoreMapping<S extends Stack>(
  inst: Ir.StoreMappingInstruction,
): Transition<S, S> {
  return (
    pipe<S>()
      // Store key at scratch space offset 0
      .then(loadValue(inst.key))
      .then(PUSHn(0n), { as: "offset" })
      .then(MSTORE())

      // Store mapping slot at scratch space offset 32
      .then(PUSHn(BigInt(inst.slot)))
      .then(PUSHn(32n), { as: "offset" })
      .then(MSTORE())

      // Load value first (will be second on stack)
      .then(loadValue(inst.value), { as: "value" })

      // Hash 64 bytes to get storage location: keccak256(key . slot)
      .then(PUSHn(64n), { as: "size" })
      .then(PUSHn(0n), { as: "offset" })
      .then(KECCAK256(), { as: "key" })

      // Now we have [key, value, ...] on stack, which SSTORE expects
      .then(SSTORE())
      .done()
  );
}
