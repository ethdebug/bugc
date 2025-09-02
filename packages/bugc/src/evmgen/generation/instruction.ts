/**
 * IR instruction code generation
 */

import * as Ir from "../../ir";
import type { Stack, StackBrand } from "../../evm";
import { EvmError, EvmErrorCode } from "../errors";
import { Severity } from "../../result";
import { type GenState, rebrandTop, operations } from "../operations";
import { loadValue, storeValueIfNeeded } from "./utils";

/**
 * Generate code for a single IR instruction
 */
export function generateInstruction<S extends Stack>(
  state: GenState<S>,
  inst: Ir.IrInstruction,
) {
  switch (inst.kind) {
    case "const":
      return generateConst(state, inst);
    case "binary":
      return generateBinary(state, inst);
    case "unary":
      return generateUnary(state, inst);
    case "load_storage":
      return generateLoadStorage(state, inst);
    case "store_storage":
      return generateStoreStorage(state, inst);
    case "load_local":
      return generateLoadLocal(state, inst);
    case "store_local":
      return generateStoreLocal(state, inst);
    case "env":
      return generateEnvOp(state, inst as Ir.EnvInstruction);
    case "hash":
      return generateHashOp(state, inst);
    case "length":
      return generateLength(state, inst);
    case "compute_slot":
      return generateComputeSlot(state, inst);
    case "compute_array_slot":
      return generateComputeArraySlot(state, inst);
    default: {
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
    }
  }
}

/**
 * Generate a binary operation
 */
export function generateBinary<S extends Stack>(
  state: GenState<S>,
  inst: Ir.BinaryOpInstruction,
): GenState<readonly ["value", ...S]> {
  const s1 = rebrandTop(loadValue(state, inst.left), "b");
  const s2 = rebrandTop(loadValue(s1, inst.right), "a");

  const map: {
    [O in Ir.BinaryOp]: <S extends Stack>(
      state: GenState<readonly ["a", "b", ...S]>,
    ) => GenState<readonly [StackBrand, ...S]>;
  } = {
    add: operations.ADD,
    sub: operations.SUB,
    mul: operations.MUL,
    div: operations.DIV,
    mod: operations.MOD,
    eq: operations.EQ,
    ne: (state) =>
      operations.NOT(operations.EQ(state, { produces: ["a"] as const })),
    lt: operations.LT,
    le: (state) =>
      operations.NOT(operations.GT(state, { produces: ["a"] as const })),
    gt: operations.GT,
    ge: (state) =>
      operations.NOT(operations.LT(state, { produces: ["a"] as const })),
    and: operations.AND,
    or: operations.OR,
  };

  const result = rebrandTop(map[inst.op](s2), "value");

  return storeValueIfNeeded(result, inst.dest);
}

/**
 * Generate a unary operation
 */
export function generateUnary<S extends Stack>(
  state: GenState<S>,
  inst: Ir.UnaryOpInstruction,
): GenState<readonly ["value", ...S]> {
  const s1 = rebrandTop(loadValue(state, inst.operand), "a");

  const map: {
    [O in Ir.UnaryOp]: <S extends Stack>(
      state: GenState<readonly ["a", ...S]>,
    ) => GenState<readonly [StackBrand, ...S]>;
  } = {
    not: operations.NOT,
    neg: (state) => {
      const s0 = rebrandTop(state, "b");
      const s1 = operations.PUSHn(s0, 0n, { brand: "a" });
      return operations.SUB(s1);
    },
  };

  const result = rebrandTop(map[inst.op](s1), "value");

  return storeValueIfNeeded(result, inst.dest);
}

/**
 * Generate a const instruction
 */
export function generateConst<S extends Stack>(
  state: GenState<S>,
  inst: Ir.ConstInstruction,
): GenState<readonly ["value", ...S]> {
  const s = operations.PUSHn(state, BigInt(inst.value));
  return storeValueIfNeeded(s, inst.dest);
}

/**
 * Generate local load
 */
export function generateLoadLocal<S extends Stack>(
  state: GenState<S>,
  inst: Ir.LoadLocalInstruction,
): GenState<readonly ["value", ...S]> {
  const { PUSHn, MLOAD } = operations;

  const allocation = state.memory.allocations[inst.local];
  if (allocation === undefined) {
    throw new EvmError(
      EvmErrorCode.MEMORY_ALLOCATION_FAILED,
      `Local ${inst.local} not allocated in memory`,
    );
  }

  const s1 = PUSHn(state, BigInt(allocation.offset), { brand: "offset" });
  const s2 = MLOAD(s1);

  return storeValueIfNeeded(s2, inst.dest);
}

/**
 * Generate local store
 */
export function generateStoreLocal<S extends Stack>(
  state: GenState<readonly [...S]>,
  inst: Ir.StoreLocalInstruction,
): GenState<readonly [...S]> {
  const allocation = state.memory.allocations[inst.local];
  if (allocation === undefined) {
    throw new EvmError(
      EvmErrorCode.MEMORY_ALLOCATION_FAILED,
      `Local ${inst.local} not allocated in memory`,
    );
  }

  const s1 = loadValue(state, inst.value);
  const s2 = operations.PUSHn(s1, BigInt(allocation.offset), { brand: "offset" });
  return operations.MSTORE(s2);
}

/**
 * Generate storage load
 */
export function generateLoadStorage<S extends Stack>(
  state: GenState<S>,
  inst: Ir.LoadStorageInstruction,
): GenState<readonly ["value", ...S]> {
  const s1 = rebrandTop(loadValue(state, inst.slot), "key");
  const result = operations.SLOAD(s1);
  return storeValueIfNeeded(rebrandTop(result, "value"), inst.dest);
}

/**
 * Generate storage store
 */
export function generateStoreStorage<S extends Stack>(
  state: GenState<readonly [...S]>,
  inst: Ir.StoreStorageInstruction,
): GenState<readonly [...S]> {
  const s1 = rebrandTop(loadValue(state, inst.value), "value");
  const s2 = rebrandTop(loadValue(s1, inst.slot), "key");
  const s3 = operations.SSTORE(s2);
  return s3;
}

/**
 * Generate environment operations
 */
export function generateEnvOp<S extends Stack>(
  state: GenState<readonly [...S]>,
  inst: Ir.EnvInstruction,
): GenState<readonly ["value", ...S]> {
  const map: {
    [O in Ir.EnvOp]: <S extends Stack>(
      state: GenState<readonly [...S]>,
    ) => GenState<readonly [StackBrand, ...S]>;
  } = {
    msg_sender: operations.CALLER,
    msg_value: operations.CALLVALUE,
    msg_data: operations.PUSH0, // Simplified for now
    block_timestamp: operations.TIMESTAMP,
    block_number: operations.NUMBER,
  };

  const result = rebrandTop(map[inst.op](state), "value");
  return storeValueIfNeeded(result, inst.dest);
}

export function generateLength<S extends Stack>(
  state: GenState<readonly [...S]>,
  inst: Ir.LengthInstruction,
) {
  // Length instruction - behavior depends on the type
  const objectType = inst.object.type;

  if (objectType.kind === "array") {
    if (objectType.size !== undefined) {
      // Fixed-size array - emit the constant
      const s1 = operations.PUSHn(state, BigInt(objectType.size));
      return storeValueIfNeeded(s1, inst.dest);
    } else {
      // Dynamic array - length is stored at the array's base slot
      const s1 = rebrandTop(loadValue(state, inst.object), "key");
      const s2 = operations.SLOAD(s1);
      return storeValueIfNeeded(s2, inst.dest);
    }
  }

  if (objectType.kind === "bytes") {
    if (objectType.size !== undefined) {
      // Fixed-size bytes - emit the constant
      const s1 = operations.PUSHn(state, BigInt(objectType.size));
      return storeValueIfNeeded(s1, inst.dest);
    }
  }

  throw new EvmError(
    EvmErrorCode.UNSUPPORTED_INSTRUCTION,
    `length operation not supported for type: ${objectType.kind}`,
  );
}

export function generateHashOp<S extends Stack>(
  state: GenState<readonly [...S]>,
  inst: Ir.HashInstruction,
) {
  const s1 = loadValue(state, inst.value);

  // Store value at memory offset 0
  const s2 = operations.PUSHn(s1, 0n, { brand: "offset" });
  const s3 = operations.MSTORE(s2);

  // Hash 32 bytes starting at offset 0
  const s4 = operations.PUSHn(s3, 32n, { brand: "size" });
  const s5 = operations.PUSHn(s4, 0n, { brand: "offset" });
  const s6 = operations.KECCAK256(s5);

  const s7 = rebrandTop(s6, "value");

  return storeValueIfNeeded(s7, inst.dest);
}

export function generateComputeSlot<S extends Stack>(
  state: GenState<readonly [...S]>,
  inst: Ir.ComputeSlotInstruction,
) {
  // store key then baseSlot in memory as 32 bytes each
  const s1 = loadValue(state, inst.key);

  const s2 = operations.PUSHn(s1, 0n, { brand: "offset" });
  const s3 = operations.MSTORE(s2);

  const s4 = loadValue(s3, inst.baseSlot);
  const s5 = operations.PUSHn(s4, 32n, { brand: "offset" });
  const s6 = operations.MSTORE(s5);

  const s7 = operations.PUSHn(s6, 64n, { brand: "size" });
  const s8 = operations.PUSHn(s7, 0n, { brand: "offset" });
  const s9 = operations.KECCAK256(s8, { produces: ["value"] as const });

  return storeValueIfNeeded(s9, inst.dest);
}

export function generateComputeArraySlot<S extends Stack>(
  state: GenState<readonly [...S]>,
  inst: Ir.ComputeArraySlotInstruction,
) {
  // For arrays: keccak256(baseSlot)
  const s1 = loadValue(state, inst.baseSlot);
  // s1 has baseSlot on tracked stack

  // Store baseSlot at memory offset 0
  const s2 = operations.PUSHn(s1, 0n, { brand: "offset" });
  const s3 = operations.MSTORE(s2);

  // Hash 32 bytes starting at offset 0
  const s4 = operations.PUSHn(s3, 32n, { brand: "size" });
  const s5 = operations.PUSHn(s4, 0n, { brand: "offset" });
  const s6 = operations.KECCAK256(s5);

  const s7 = rebrandTop(s6, "value");

  return storeValueIfNeeded(s7, inst.dest);
}

