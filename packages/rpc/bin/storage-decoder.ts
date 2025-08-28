/**
 * Storage decoder for BUG contracts
 * Decodes storage values based on type information from debug info
 */

import * as Format from "@ethdebug/format";
import { keccak256 } from "ethereum-cryptography/keccak";
import { bytesToHex, hexToBytes } from "ethereum-cryptography/utils";

export interface StorageSlotInfo {
  slot: number;
  offset: number;
  type: Format.Type;
  value?: string;
}

export class StorageDecoder {
  /**
   * Decode a storage value based on its type
   */
  decodeStorageValue(value: string, type: Format.Type): unknown {
    // Remove 0x prefix
    const cleanValue = value.startsWith("0x") ? value.slice(2) : value;

    switch (type.kind) {
      case "uint": {
        const uintType = type as Format.Type.Elementary.Uint;
        return this.decodeUint(cleanValue, uintType.bits);
      }

      case "int": {
        const intType = type as Format.Type.Elementary.Int;
        return this.decodeInt(cleanValue, intType.bits);
      }

      case "bool":
        return this.decodeBool(cleanValue);

      case "address":
        return this.decodeAddress(cleanValue);

      case "bytes": {
        const bytesType = type as Format.Type.Elementary.Bytes;
        if (bytesType.size) {
          return this.decodeFixedBytes(cleanValue, bytesType.size);
        } else {
          return this.decodeDynamicBytes(cleanValue);
        }
      }

      case "string":
        return this.decodeString(cleanValue);

      default:
        return value; // Return raw value for complex types
    }
  }

  /**
   * Format a decoded value for display
   */
  formatStorageValue(value: unknown, type: Format.Type): string {
    if (value === null || value === undefined) {
      return "null";
    }

    switch (type.kind) {
      case "uint":
      case "int":
        return value.toString();

      case "bool":
        return value ? "true" : "false";

      case "address":
        return value as string;

      case "bytes":
        return value as string;

      case "string":
        return `"${value}"`;

      case "array":
        return `array`;

      case "mapping":
        return "mapping";

      case "struct":
        return `struct`;

      default:
        return String(value);
    }
  }

  /**
   * Compute storage slot for array element
   */
  computeArraySlot(baseSlot: bigint, index: bigint): bigint {
    // For fixed arrays in BUG: keccak256(slot) + index
    const slotBytes = this.padLeft(baseSlot.toString(16), 32);
    const hash = keccak256(hexToBytes(slotBytes));
    const hashBigInt = BigInt("0x" + bytesToHex(hash));
    return hashBigInt + index;
  }

  /**
   * Compute storage slot for mapping value
   */
  computeMappingSlot(baseSlot: bigint, key: string): bigint {
    // keccak256(key || slot)
    const keyBytes = this.padLeft(key.slice(2), 32); // Remove 0x and pad
    const slotBytes = this.padLeft(baseSlot.toString(16), 32);
    const data = keyBytes + slotBytes;
    const hash = keccak256(hexToBytes(data));
    return BigInt("0x" + bytesToHex(hash));
  }

  /**
   * Check if a storage value is zero (empty)
   */
  isZeroValue(value: string): boolean {
    const cleanValue = value.startsWith("0x") ? value.slice(2) : value;
    return cleanValue === "0" || /^0+$/.test(cleanValue);
  }

  // Private decoding methods

  private decodeUint(value: string, _bits: number): bigint {
    return BigInt("0x" + value);
  }

  private decodeInt(value: string, bits: number): bigint {
    const uint = BigInt("0x" + value);
    const maxPositive = BigInt(1) << BigInt(bits - 1);
    const maxValue = BigInt(1) << BigInt(bits);

    // Check if negative (high bit set)
    if (uint >= maxPositive) {
      return uint - maxValue;
    }
    return uint;
  }

  private decodeBool(value: string): boolean {
    return BigInt("0x" + value) !== 0n;
  }

  private decodeAddress(value: string): string {
    // Take last 20 bytes (40 hex chars)
    const addr = value.slice(-40).padStart(40, "0");
    return "0x" + addr;
  }

  private decodeFixedBytes(value: string, size: number): string {
    // Take first N bytes
    const bytes = value.slice(0, size * 2).padEnd(size * 2, "0");
    return "0x" + bytes;
  }

  private decodeDynamicBytes(value: string): string {
    // For dynamic bytes, the slot contains length * 2 + 1 if short (< 32 bytes)
    // or just length * 2 if data is stored elsewhere
    const lengthIndicator = BigInt("0x" + value);

    if (lengthIndicator & 1n) {
      // Short string/bytes (stored in same slot)
      const length = Number(lengthIndicator >> 1n);
      const data = value.slice(0, length * 2);
      return "0x" + data;
    } else {
      // Long string/bytes (stored in other slots)
      const length = Number(lengthIndicator >> 1n);
      return `0x... (${length} bytes in storage)`;
    }
  }

  private decodeString(value: string): string {
    // Similar to dynamic bytes
    const lengthIndicator = BigInt("0x" + value);

    if (lengthIndicator & 1n) {
      // Short string
      const length = Number(lengthIndicator >> 1n);
      const data = value.slice(0, length * 2);
      try {
        const bytes = hexToBytes(data);
        return new TextDecoder().decode(bytes);
      } catch {
        return "0x" + data;
      }
    } else {
      // Long string
      const length = Number(lengthIndicator >> 1n);
      return `<string of ${length} bytes>`;
    }
  }

  private padLeft(hex: string, bytes: number): string {
    return hex.padStart(bytes * 2, "0");
  }
}
