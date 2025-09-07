/**
 * Type factories and utilities for the BUG type system
 */

import { type Type, ElementaryType } from "./definitions.js";

// Type utilities
export const Types = {
  // Singleton instances for elementary types
  uint256: new ElementaryType("uint", 256),
  uint128: new ElementaryType("uint", 128),
  uint64: new ElementaryType("uint", 64),
  uint32: new ElementaryType("uint", 32),
  uint16: new ElementaryType("uint", 16),
  uint8: new ElementaryType("uint", 8),
  int256: new ElementaryType("int", 256),
  int128: new ElementaryType("int", 128),
  int64: new ElementaryType("int", 64),
  int32: new ElementaryType("int", 32),
  int16: new ElementaryType("int", 16),
  int8: new ElementaryType("int", 8),
  address: new ElementaryType("address"),
  bool: new ElementaryType("bool"),
  bytes: new ElementaryType("bytes"), // Dynamic bytes
  bytes32: new ElementaryType("bytes", 256),
  bytes16: new ElementaryType("bytes", 128),
  bytes8: new ElementaryType("bytes", 64),
  bytes4: new ElementaryType("bytes", 32),
  string: new ElementaryType("string"),

  isUintType(type: Type): boolean {
    return type instanceof ElementaryType && type.kind === "uint";
  },

  isIntType(type: Type): boolean {
    return type instanceof ElementaryType && type.kind === "int";
  },

  isBytesType(type: Type): boolean {
    return type instanceof ElementaryType && type.kind === "bytes";
  },

  isDynamicBytesType(type: Type): boolean {
    return (
      type instanceof ElementaryType &&
      type.kind === "bytes" &&
      type.bits === undefined
    );
  },

  isStringType(type: Type): boolean {
    return type instanceof ElementaryType && type.kind === "string";
  },

  isAddressType(type: Type): boolean {
    return type instanceof ElementaryType && type.kind === "address";
  },

  isNumericType(type: Type): boolean {
    return this.isUintType(type) || this.isIntType(type);
  },

  toString(type: Type): string {
    return type.toString();
  },

  isComparable(type: Type): boolean {
    return (
      type instanceof ElementaryType &&
      (this.isNumericType(type) ||
        type.kind === "address" ||
        this.isBytesType(type))
    );
  },

  areCompatible(type1: Type, type2: Type): boolean {
    // Same types are always compatible
    if (type1.equals(type2)) {
      return true;
    }

    // Numeric types can be implicitly converted (with range checks)
    if (this.isNumericType(type1) && this.isNumericType(type2)) {
      // Only allow same signedness
      if (this.isUintType(type1) && this.isUintType(type2)) {
        return true;
      }
      if (this.isIntType(type1) && this.isIntType(type2)) {
        return true;
      }
    }

    // Bytes types can be compared if they're both bytes
    if (this.isBytesType(type1) && this.isBytesType(type2)) {
      return true;
    }

    // No other implicit conversions
    return false;
  },

  commonType(type1: Type, type2: Type): Type | null {
    if (type1.equals(type2)) {
      return type1;
    }

    // For numeric types, return the larger type
    if (type1 instanceof ElementaryType && type2 instanceof ElementaryType) {
      if (this.isUintType(type1) && this.isUintType(type2)) {
        const size1 = type1.bits || 256;
        const size2 = type2.bits || 256;
        return size1 >= size2 ? type1 : type2;
      }
      if (this.isIntType(type1) && this.isIntType(type2)) {
        const size1 = type1.bits || 256;
        const size2 = type2.bits || 256;
        return size1 >= size2 ? type1 : type2;
      }
    }

    return null;
  },
};
