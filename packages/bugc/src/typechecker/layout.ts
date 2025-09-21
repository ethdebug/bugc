import { Type } from "../types/index.js";

/**
 * Compute storage layout for a struct's fields.
 * For now, uses simple non-packed layout (each field gets its own slot).
 * Future: implement Solidity-style packing for fields that fit together.
 */
export function computeStructLayout(
  fields: Map<string, Type>,
): Map<string, Type.FieldLayout> {
  const layout = new Map<string, Type.FieldLayout>();
  let currentOffset = 0;

  for (const [fieldName, fieldType] of fields) {
    const size = getTypeSize(fieldType);

    // Simple layout: each field starts at a 32-byte boundary
    // This ensures each field gets its own storage slot
    layout.set(fieldName, {
      byteOffset: currentOffset,
      size: size,
    });

    // Move to next 32-byte slot
    currentOffset += 32;
  }

  return layout;
}

/**
 * Get the storage size of a type in bytes.
 * For storage, values are padded to 32 bytes.
 */
function getTypeSize(type: Type): number {
  switch (type.kind) {
    case "bool":
      return 1;
    case "uint":
    case "int":
      return Math.ceil(type.bits / 8);
    case "address":
      return 20;
    case "bytes":
      return type.size || 32; // Fixed-size bytes or dynamic
    case "string":
    case "array":
    case "mapping":
    case "struct":
      return 32; // Reference types take full slot
    default:
      return 32;
  }
}
