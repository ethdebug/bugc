import * as Format from "@ethdebug/format";

import type { Type } from "./type.js";
import { Value } from "./value.js";

export type Instruction =
  // Constants
  | Instruction.Const
  // Memory management
  | Instruction.Allocate
  // Unified read/write operations
  | Instruction.Read
  | Instruction.Write
  // Storage slot computation
  | Instruction.ComputeSlot
  // Unified compute operations
  | Instruction.ComputeOffset
  // Arithmetic and logic
  | Instruction.BinaryOp
  | Instruction.UnaryOp
  // Environment access
  | Instruction.Env
  // Type operations
  | Instruction.Hash
  | Instruction.Cast
  // Length operations
  | Instruction.Length;

export namespace Instruction {
  export interface Base {
    kind: string;
    debug: Instruction.Debug;
  }

  export interface Debug {
    context?: Format.Program.Context;
  }

  // Location types for unified read/write
  export type Location =
    | "storage"
    | "transient"
    | "memory"
    | "calldata"
    | "returndata"
    | "code"
    | "local";

  // NEW: Unified Read instruction
  export interface Read extends Instruction.Base {
    kind: "read";
    location: Location;
    // For storage/transient (segment-based)
    slot?: Value;
    // For all locations that need offset
    offset?: Value;
    // Length in bytes
    length?: Value;
    // For local variables
    name?: string;
    // Destination and type
    dest: string;
    type: Type;
  }

  // NEW: Unified Write instruction
  export interface Write extends Instruction.Base {
    kind: "write";
    location: Exclude<Location, "calldata" | "returndata" | "code">; // No writes to read-only locations
    // For storage/transient (segment-based)
    slot?: Value;
    // For all locations that need offset
    offset?: Value;
    // Length in bytes
    length?: Value;
    // For local variables
    name?: string;
    // Value to write
    value: Value;
  }

  // NEW: Unified compute offset instruction
  export type ComputeOffset =
    | ComputeOffset.Array
    | ComputeOffset.Field
    | ComputeOffset.Byte;

  export namespace ComputeOffset {
    export interface Base extends Instruction.Base {
      kind: "compute_offset";
      offsetKind: "array" | "field" | "byte";
      location: "memory" | "calldata" | "returndata" | "code";
      base: Value;
      dest: string;
    }

    export interface Array extends ComputeOffset.Base {
      offsetKind: "array";
      index: Value;
      stride: number;
    }

    export const isArray = (inst: ComputeOffset): inst is ComputeOffset.Array =>
      inst.offsetKind === "array";

    export const array = (
      location: "memory" | "calldata" | "returndata" | "code",
      base: Value,
      index: Value,
      stride: number,
      dest: string,
      debug: Instruction.Debug,
    ): ComputeOffset.Array => ({
      kind: "compute_offset",
      offsetKind: "array",
      location,
      base,
      index,
      stride,
      dest,
      debug,
    });

    export interface Field extends ComputeOffset.Base {
      offsetKind: "field";
      field: string;
      fieldOffset: number;
    }

    export const isField = (inst: ComputeOffset): inst is ComputeOffset.Field =>
      inst.offsetKind === "field";

    export const field = (
      location: "memory" | "calldata" | "returndata" | "code",
      base: Value,
      field: string,
      fieldOffset: number,
      dest: string,
      debug: Instruction.Debug,
    ): ComputeOffset.Field => ({
      kind: "compute_offset",
      offsetKind: "field",
      location,
      base,
      field,
      fieldOffset,
      dest,
      debug,
    });

    export interface Byte extends ComputeOffset.Base {
      offsetKind: "byte";
      offset: Value;
    }

    export const isByte = (inst: ComputeOffset): inst is ComputeOffset.Byte =>
      inst.offsetKind === "byte";

    export const byte = (
      location: "memory" | "calldata" | "returndata" | "code",
      base: Value,
      offset: Value,
      dest: string,
      debug: Instruction.Debug,
    ): ComputeOffset.Byte => ({
      kind: "compute_offset",
      offsetKind: "byte",
      location,
      base,
      offset,
      dest,
      debug,
    });
  }

  export interface Const extends Instruction.Base {
    kind: "const";
    value: bigint | string | boolean;
    type: Type;
    dest: string;
  }

  // Memory allocation instruction
  export interface Allocate extends Instruction.Base {
    kind: "allocate";
    location: "memory"; // For now, only memory allocation
    size: Value; // Size in bytes to allocate
    dest: string; // Destination temp for the allocated pointer
  }

  export type ComputeSlot =
    | ComputeSlot.Mapping
    | ComputeSlot.Array
    | ComputeSlot.Field;

  export namespace ComputeSlot {
    export interface Base extends Instruction.Base {
      kind: "compute_slot";
      slotKind: "mapping" | "array" | "field";
      base: Value;
      dest: string;
    }

    export interface Mapping extends ComputeSlot.Base {
      slotKind: "mapping";
      key: Value;
      keyType: Type;
    }

    export const isMapping = (inst: ComputeSlot): inst is ComputeSlot.Mapping =>
      inst.slotKind === "mapping";

    export const mapping = (
      base: Value,
      key: Value,
      keyType: Type,
      dest: string,
      debug: Instruction.Debug,
    ): ComputeSlot.Mapping => ({
      kind: "compute_slot",
      slotKind: "mapping",
      base,
      key,
      keyType,
      dest,
      debug,
    });

    export interface Array extends ComputeSlot.Base {
      slotKind: "array";
      // No index - just computes the first slot of the array
    }

    export const isArray = (inst: ComputeSlot): inst is ComputeSlot.Array =>
      inst.slotKind === "array";

    export const array = (
      base: Value,
      dest: string,
      debug: Instruction.Debug,
    ): ComputeSlot.Array => ({
      kind: "compute_slot",
      slotKind: "array",
      base,
      dest,
      debug,
    });

    export interface Field extends ComputeSlot.Base {
      slotKind: "field";
      fieldOffset: number; // Byte offset from struct base
    }

    export const isField = (inst: ComputeSlot): inst is ComputeSlot.Field =>
      inst.slotKind === "field";

    export const field = (
      base: Value,
      fieldOffset: number,
      dest: string,
      debug: Instruction.Debug,
    ): ComputeSlot.Field => ({
      kind: "compute_slot",
      slotKind: "field",
      base,
      fieldOffset,
      dest,
      debug,
    });
  }

  export interface BinaryOp extends Instruction.Base {
    kind: "binary";
    op: // Arithmetic
    | "add"
      | "sub"
      | "mul"
      | "div"
      | "mod"
      // Bitwise
      | "shl"
      | "shr"
      // Comparison
      | "eq"
      | "ne"
      | "lt"
      | "le"
      | "gt"
      | "ge"
      // Logical
      | "and"
      | "or";
    left: Value;
    right: Value;
    dest: string;
  }

  export interface UnaryOp extends Instruction.Base {
    kind: "unary";
    op: "not" | "neg";
    operand: Value;
    dest: string;
  }

  export interface Env extends Instruction.Base {
    kind: "env";
    op:
      | "msg_sender"
      | "msg_value"
      | "msg_data"
      | "block_number"
      | "block_timestamp";

    dest: string;
  }

  export interface Hash extends Instruction.Base {
    kind: "hash";
    value: Value;
    dest: string;
  }

  export interface Cast extends Instruction.Base {
    kind: "cast";
    value: Value;
    targetType: Type;
    dest: string;
  }

  // Call instruction removed - calls are now block terminators

  export interface Length extends Instruction.Base {
    kind: "length";
    object: Value;
    dest: string;
  }
}
