/**
 * Pointer generation utilities for ethdebug/format integration
 *
 * Converts runtime variable locations to ethdebug/format pointer
 * expressions
 */

import * as Format from "@ethdebug/format";

/**
 * Variable location information
 */
export type VariableLocation =
  | { kind: "storage"; slot: number | bigint }
  | { kind: "storage-computed"; expression: Format.Pointer.Expression }
  | {
      kind: "memory";
      offset: number | bigint;
      length: number | bigint;
    }
  | {
      kind: "memory-computed";
      offsetExpression: Format.Pointer.Expression;
      lengthExpression: Format.Pointer.Expression;
    }
  | {
      kind: "calldata";
      offset: number | bigint;
      length: number | bigint;
    }
  | { kind: "stack"; slot: number }
  | { kind: "transient"; slot: number | bigint }
  | { kind: "unknown" };

/**
 * Generate an ethdebug/format pointer for a variable location
 */
export function generatePointer(
  location: VariableLocation,
): Format.Pointer | undefined {
  switch (location.kind) {
    case "storage":
      return {
        location: "storage",
        slot: Number(location.slot),
      };

    case "storage-computed":
      return {
        location: "storage",
        slot: location.expression,
      };

    case "memory":
      return {
        location: "memory",
        offset: Number(location.offset),
        length: Number(location.length),
      };

    case "memory-computed":
      return {
        location: "memory",
        offset: location.offsetExpression,
        length: location.lengthExpression,
      };

    case "calldata":
      return {
        location: "calldata",
        offset: Number(location.offset),
        length: Number(location.length),
      };

    case "transient":
      return {
        location: "transient",
        slot: Number(location.slot),
      };

    case "stack":
      // Stack-based SSA temps don't have concrete runtime locations yet
      // at IR generation time. They only get stack positions during
      // EVM code generation. So we can't generate pointers for them here.
      return undefined;

    case "unknown":
      return undefined;
  }
}

/**
 * Translate storage slot computation instructions to pointer expressions
 *
 * This analyzes chains of IR instructions that compute storage slots
 * (e.g., for mappings, arrays) and converts them to ethdebug/format
 * pointer expressions using $keccak256, $sum, etc.
 *
 * For now, this is a placeholder. Full implementation will analyze
 * compute_slot instructions and their operands.
 */
export function translateStorageComputation(
  _baseSlot: number,
  _computationChain: unknown[],
): Format.Pointer.Expression {
  // TODO: Implement full translation of compute_slot chains
  // This should handle:
  // - Mapping access: keccak256(key, slot)
  // - Array indexing: slot + (index * elementSize)
  // - Struct field access: slot + fieldOffset
  // - Nested combinations of the above

  // Placeholder: return base slot as literal
  return _baseSlot;
}

/**
 * Helper to create pointer expression for mapping access
 *
 * Generates: keccak256(concat(key, slot))
 */
export function mappingAccess(
  slot: number | Format.Pointer.Expression,
  key: Format.Pointer.Expression,
): Format.Pointer.Expression {
  return {
    $keccak256: [{ $wordsized: key }, slot],
  };
}

/**
 * Helper to create pointer expression for array element access
 *
 * For dynamic arrays: slot for length, keccak256(slot) + index for elements
 * For fixed arrays: slot + index
 */
export function arrayElementAccess(
  baseSlot: number | Format.Pointer.Expression,
  index: number | Format.Pointer.Expression,
  isDynamic: boolean,
): Format.Pointer.Expression {
  if (isDynamic) {
    // Dynamic array: keccak256(slot) + index
    return {
      $sum: [{ $keccak256: [baseSlot] }, index],
    };
  } else {
    // Fixed array: slot + index
    return {
      $sum: [baseSlot, index],
    };
  }
}

/**
 * Helper to create pointer expression for struct field access
 *
 * Generates: slot + fieldOffset
 */
export function structFieldAccess(
  baseSlot: number | Format.Pointer.Expression,
  fieldOffset: number,
): Format.Pointer.Expression {
  if (fieldOffset === 0) {
    return baseSlot;
  }

  return {
    $sum: [baseSlot, fieldOffset],
  };
}
