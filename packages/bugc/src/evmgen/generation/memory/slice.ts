import type * as Ir from "../../../ir";

/**
 * Get the size of a type in bytes
 */
export function getTypeSize(type: Ir.TypeRef): bigint {
  switch (type.kind) {
    case "uint":
    case "int":
      return BigInt(type.bits / 8);
    case "address":
      return 20n; // addresses are 20 bytes but padded to 32 in storage/memory
    case "bool":
      return 1n; // bools are 1 byte but padded to 32 in storage/memory
    case "bytes":
      if (type.size) {
        return BigInt(type.size); // fixed-size bytes
      }
      return 32n; // dynamic bytes use a pointer
    case "string":
      return 32n; // strings use a pointer
    case "array":
      return 32n; // arrays use a pointer to the data
    case "mapping":
      return 32n; // mappings are storage-only, represented as slot
    case "struct":
      // For now, assume structs are word-aligned
      // A proper implementation would sum field sizes
      return 32n;
    default:
      return 32n; // default to word size
  }
}

/**
 * Get the element size for sliceable types
 * Returns the size of each element in bytes
 */
export function getSliceElementSize(type: Ir.TypeRef): bigint {
  switch (type.kind) {
    case "array":
      // Copying Solidity, all array elements are padded to 32 bytes in memory
      // Even if the element type is smaller
      return 32n;
    case "string":
    case "bytes":
      return 1n;
    default:
      throw new Error(`Expected type, got ${type.kind}`);
  }
}
/**
 * Get the offset where actual data starts for sliceable types.
 * For dynamic bytes/strings in memory, data starts after the 32-byte length field.
 * For fixed-size bytes and arrays, data starts immediately.
 */
export function getSliceDataOffset(type: Ir.TypeRef): bigint {
  switch (type.kind) {
    case "bytes":
      // Dynamic bytes have a 32-byte length field before the data
      return type.size === undefined ? 32n : 0n;
    case "string":
      // Strings always have a 32-byte length field before the data
      return 32n;
    case "array":
      // Arrays in memory start with data immediately after the pointer
      // (the length is stored separately if it's dynamic)
      return 0n;
    default:
      throw new Error(`Cannot get data offset for type ${type.kind}`);
  }
}
