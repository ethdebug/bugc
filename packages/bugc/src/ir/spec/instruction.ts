import type * as Ast from "#ast";

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
  export interface Read {
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
    loc?: Ast.SourceLocation;
  }

  // NEW: Unified Write instruction
  export interface Write {
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
    loc?: Ast.SourceLocation;
  }

  // NEW: Unified compute offset instruction
  export type ComputeOffset =
    | ComputeOffset.Array
    | ComputeOffset.Field
    | ComputeOffset.Byte;

  export namespace ComputeOffset {
    export interface Base {
      kind: "compute_offset";
      offsetKind: "array" | "field" | "byte";
      location: "memory" | "calldata" | "returndata" | "code";
      base: Value;
      dest: string;
      loc?: Ast.SourceLocation;
    }

    export interface Array extends Base {
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
      loc?: Ast.SourceLocation,
    ): ComputeOffset.Array => ({
      kind: "compute_offset",
      offsetKind: "array",
      location,
      base,
      index,
      stride,
      dest,
      loc,
    });

    export interface Field extends Base {
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
      loc?: Ast.SourceLocation,
    ): ComputeOffset.Field => ({
      kind: "compute_offset",
      offsetKind: "field",
      location,
      base,
      field,
      fieldOffset,
      dest,
      loc,
    });

    export interface Byte extends Base {
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
      loc?: Ast.SourceLocation,
    ): ComputeOffset.Byte => ({
      kind: "compute_offset",
      offsetKind: "byte",
      location,
      base,
      offset,
      dest,
      loc,
    });
  }

  export interface Const {
    kind: "const";
    value: bigint | string | boolean;
    type: Type;
    dest: string;
    loc?: Ast.SourceLocation;
  }

  // Memory allocation instruction
  export interface Allocate {
    kind: "allocate";
    location: "memory"; // For now, only memory allocation
    size: Value; // Size in bytes to allocate
    dest: string; // Destination temp for the allocated pointer
    loc?: Ast.SourceLocation;
  }

  export type ComputeSlot =
    | ComputeSlot.Mapping
    | ComputeSlot.Array
    | ComputeSlot.Field;

  export namespace ComputeSlot {
    export interface Base {
      kind: "compute_slot";
      slotKind: "mapping" | "array" | "field";
      base: Value;
      dest: string;
      loc?: Ast.SourceLocation;
    }

    export interface Mapping extends Base {
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
      loc?: Ast.SourceLocation,
    ): ComputeSlot.Mapping => ({
      kind: "compute_slot",
      slotKind: "mapping",
      base,
      key,
      keyType,
      dest,
      loc,
    });

    export interface Array extends Base {
      slotKind: "array";
      index: Value;
    }

    export const isArray = (inst: ComputeSlot): inst is ComputeSlot.Array =>
      inst.slotKind === "array";

    export const array = (
      base: Value,
      index: Value,
      dest: string,
      loc?: Ast.SourceLocation,
    ): ComputeSlot.Array => ({
      kind: "compute_slot",
      slotKind: "array",
      base,
      index,
      dest,
      loc,
    });

    export interface Field extends Base {
      slotKind: "field";
      fieldOffset: number; // Byte offset from struct base
    }

    export const isField = (inst: ComputeSlot): inst is ComputeSlot.Field =>
      inst.slotKind === "field";

    export const field = (
      base: Value,
      fieldOffset: number,
      dest: string,
      loc?: Ast.SourceLocation,
    ): ComputeSlot.Field => ({
      kind: "compute_slot",
      slotKind: "field",
      base,
      fieldOffset,
      dest,
      loc,
    });
  }

  export interface BinaryOp {
    kind: "binary";
    op: // Arithmetic
    | "add"
      | "sub"
      | "mul"
      | "div"
      | "mod"
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
    loc?: Ast.SourceLocation;
  }

  export interface UnaryOp {
    kind: "unary";
    op: "not" | "neg";
    operand: Value;
    dest: string;
    loc?: Ast.SourceLocation;
  }

  export interface Env {
    kind: "env";
    op:
      | "msg_sender"
      | "msg_value"
      | "msg_data"
      | "block_number"
      | "block_timestamp";

    dest: string;
    loc?: Ast.SourceLocation;
  }

  export interface Hash {
    kind: "hash";
    value: Value;
    dest: string;
    loc?: Ast.SourceLocation;
  }

  export interface Cast {
    kind: "cast";
    value: Value;
    targetType: Type;
    dest: string;
    loc?: Ast.SourceLocation;
  }

  // Call instruction removed - calls are now block terminators

  export interface Length {
    kind: "length";
    object: Value;
    dest: string;
    loc?: Ast.SourceLocation;
  }
}
