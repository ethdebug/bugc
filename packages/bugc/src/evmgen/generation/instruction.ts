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
  const { ADD, SUB, MUL, DIV, MOD, EQ, NOT, LT, GT, AND, OR } = operations;

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
  const { NOT, PUSHn, SUB } = operations;

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
  const { PUSHn } = operations;

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
  const { PUSHn, MLOAD } = operations;

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
  const { PUSHn, MSTORE } = operations;

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
  const { SLOAD } = operations;

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
  const { SSTORE } = operations;

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
    msg_sender: operations.CALLER(),
    msg_value: operations.CALLVALUE(),
    msg_data: operations.PUSH0(), // Simplified for now
    block_timestamp: operations.TIMESTAMP(),
    block_number: operations.NUMBER(),
  };

  return pipe<S>()
    .then(map[inst.op], { as: "value" })
    .then(storeValueIfNeeded(inst.dest))
    .done();
}

export function generateLength<S extends Stack>(
  inst: Ir.LengthInstruction,
): Transition<S, readonly ["value", ...S]> {
  // Length instruction - behavior depends on the type
  const objectType = inst.object.type;

  if (objectType.kind === "array") {
    if (objectType.size !== undefined) {
      const { PUSHn } = operations;

      return pipe<S>()
        .then(PUSHn(BigInt(objectType.size)))
        .then(storeValueIfNeeded(inst.dest))
        .done();
    } else {
      const { SLOAD } = operations;

      return pipe<S>()
        .then(loadValue(inst.object), { as: "key" })
        .then(SLOAD())
        .then(storeValueIfNeeded(inst.dest))
        .done();
    }
  }

  if (objectType.kind === "bytes") {
    if (objectType.size !== undefined) {
      const { PUSHn } = operations;

      return pipe<S>()
        .then(PUSHn(BigInt(objectType.size)))
        .then(storeValueIfNeeded(inst.dest))
        .done();
    }
  }

  throw new EvmError(
    EvmErrorCode.UNSUPPORTED_INSTRUCTION,
    `length operation not supported for type: ${objectType.kind}`,
  );
}

function generateHashOp<S extends Stack>(
  inst: Ir.HashInstruction,
): Transition<S, readonly ["value", ...S]> {
  const { PUSHn, MSTORE, KECCAK256 } = operations;

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
  const { PUSHn, MSTORE, KECCAK256 } = operations;

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
  const { PUSHn, MSTORE, KECCAK256 } = operations;

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
  const { PUSHn, DUP1, DUP2, SUB, MUL, ADD, SWAP1, SWAP3, MCOPY } = operations;

  const elementSize = getArrayElementSize(inst.object.type);

  // For storage arrays, we need to:
  // 1. Compute the base storage slot (compute_array_slot gives us keccak256(slot))
  // 2. For each element from start to end:
  //    - Add the index to the base slot
  //    - Load from storage
  //    - Store to memory

  // For memory arrays, we can use MCOPY directly

  // We'll check if the value came from a compute_array_slot by checking
  // if it's already in memory allocations. If not, assume it's a storage slot.

  return pipe<S>()
    .peek((state, builder) => {
      const objectId = valueId(inst.object);
      const isInMemory =
        objectId in state.memory.allocations ||
        state.stack.findIndex(({ irValue }) => irValue === objectId) > -1;

      if (!isInMemory) {
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

      // Memory array implementation (existing code)
      return (
        builder
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

          // save total bytes size because it's needed for MCOPY
          .then(DUP1())
          // Stack: [bytesSize, bytesSize, start, ...]

          // Allocate memory dynamically
          .then(allocateMemoryDynamic(), { as: "destOffset" })
          // Stack: [destOffset, bytesSize, start, ...]

          // Save destOffset for return value
          .then(DUP1())
          // Stack: [destOffset, destOffset, bytesSize, start, ...]

          // and grab start now since we won't need this new destOffset for awhile
          // this will be multiplied by the element size
          .then(SWAP3(), { as: "b" })
          // Stack: [start, destOffset, bytesSize, destOffset, ...]

          .then(PUSHn(elementSize), { as: "a" })
          .then(MUL(), { as: "b" })

          // load the pointer to the start of the sliced object
          .then(loadValue(inst.object), { as: "a" })
          // add the computed size before the slice to get
          // the starting offset in memory
          .then(ADD(), { as: "offset" })

          // re-order for MCOPY
          .then(SWAP1())
          .then(MCOPY())

          // only relevant item left on stack is the offset of the newly
          // allocated memory.
          .then(rebrandTop("value"))
          .then(storeValueIfNeeded(inst.dest))
      );
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
  const { PUSHn, MSTORE, KECCAK256, SLOAD } = operations;

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
  const { PUSHn, MSTORE, KECCAK256, SSTORE } = operations;

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
