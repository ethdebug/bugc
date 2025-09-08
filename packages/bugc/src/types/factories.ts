/**
 * Type factories and utilities for the BUG type system
 */

import { Type } from "./definitions.js";

// Type utilities
export const Types = {
  isComparable(type: Type): boolean {
    return (
      Type.isElementary(type) &&
      (Type.Elementary.isNumeric(type) ||
        Type.Elementary.isAddress(type) ||
        Type.Elementary.isBytes(type))
    );
  },

  areCompatible(type1: Type, type2: Type): boolean {
    // Same types are always compatible
    if (type1.equals(type2)) {
      return true;
    }

    // Numeric types can be implicitly converted (with range checks)
    if (Type.Elementary.isNumeric(type1) && Type.Elementary.isNumeric(type2)) {
      // Only allow same signedness
      if (Type.Elementary.isUint(type1) && Type.Elementary.isUint(type2)) {
        return true;
      }
      if (Type.Elementary.isInt(type1) && Type.Elementary.isInt(type2)) {
        return true;
      }
    }

    // Bytes types can be compared if they're both bytes
    if (Type.Elementary.isBytes(type1) && Type.Elementary.isBytes(type2)) {
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
    if (Type.isElementary(type1) && Type.isElementary(type2)) {
      if (Type.Elementary.isUint(type1) && Type.Elementary.isUint(type2)) {
        const size1 = type1.bits || 256;
        const size2 = type2.bits || 256;
        return size1 >= size2 ? type1 : type2;
      }
      if (Type.Elementary.isInt(type1) && Type.Elementary.isInt(type2)) {
        const size1 = type1.bits || 256;
        const size2 = type2.bits || 256;
        return size1 >= size2 ? type1 : type2;
      }
    }

    return null;
  },
};
