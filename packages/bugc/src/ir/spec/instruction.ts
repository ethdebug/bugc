import type * as Ast from "#ast";

import type { Type } from "./type.js";
import { Value } from "./value.js";

export type Instruction =
  // Constants
  | Instruction.Const
  // Unified read/write operations
  | Instruction.Read
  | Instruction.Write
  // Storage slot computation
  | Instruction.ComputeSlot
  | Instruction.ComputeArraySlot
  | Instruction.ComputeFieldOffset
  // Unified compute operations
  | Instruction.ComputeOffset
  // Slice operations
  | Instruction.Slice
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
  export interface ComputeOffset {
    kind: "compute_offset";
    location: "memory" | "calldata" | "returndata" | "code";
    base: Value;
    // For array access
    index?: Value;
    stride?: number;
    // For struct field access
    field?: string;
    fieldOffset?: number;
    // For raw byte offset
    byteOffset?: Value;
    dest: string;
    loc?: Ast.SourceLocation;
  }

  export interface Const {
    kind: "const";
    value: bigint | string | boolean;
    type: Type;
    dest: string;
    loc?: Ast.SourceLocation;
  }

  export interface ComputeSlot {
    kind: "compute_slot";
    baseSlot: Value; // Base storage slot (or computed slot for nested mappings)
    key: Value; // Mapping key
    keyType: Type; // Type of the key for proper encoding
    dest: string;
    loc?: Ast.SourceLocation;
  }
  export interface ComputeArraySlot {
    kind: "compute_array_slot";
    baseSlot: Value; // Array base storage slot
    dest: string;
    loc?: Ast.SourceLocation;
  }

  export interface ComputeFieldOffset {
    kind: "compute_field_offset";
    baseSlot: Value; // Base slot (struct start)
    fieldIndex: number; // Field index in the struct
    dest: string;
    loc?: Ast.SourceLocation;
  }

  export interface Slice {
    kind: "slice";
    object: Value;
    start: Value;
    end: Value;
    dest: string;
    loc?: Ast.SourceLocation;
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
