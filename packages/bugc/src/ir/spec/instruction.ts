import type * as Ast from "#ast";

import type { Type } from "./type.js";
import { Value } from "./value.js";

export type Instruction =
  // Constants
  | Instruction.Const
  // Storage operations
  | Instruction.LoadStorage
  | Instruction.StoreStorage
  | Instruction.LoadMapping
  | Instruction.StoreMapping
  // Storage slot computation
  | Instruction.ComputeSlot
  | Instruction.ComputeArraySlot
  | Instruction.ComputeFieldOffset
  // Struct field operations
  | Instruction.LoadField
  | Instruction.StoreField
  // Array operations
  | Instruction.LoadIndex
  | Instruction.StoreIndex
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
  // Function calls
  | Instruction.Call
  // Length operations
  | Instruction.Length;

export namespace Instruction {
  export interface Const {
    kind: "const";
    value: bigint | string | boolean;
    type: Type;
    dest: string;
    loc?: Ast.SourceLocation;
  }

  export interface LoadStorage {
    kind: "load_storage";
    slot: Value; // Can be constant or computed
    type: Type;
    dest: string;
    loc?: Ast.SourceLocation;
  }

  export interface StoreStorage {
    kind: "store_storage";
    slot: Value; // Can be constant or computed
    value: Value;
    loc?: Ast.SourceLocation;
  }

  export interface LoadMapping {
    kind: "load_mapping";
    slot: number;
    key: Value;
    valueType: Type;
    dest: string;
    loc?: Ast.SourceLocation;
  }

  export interface StoreMapping {
    kind: "store_mapping";
    slot: number;
    key: Value;
    value: Value;
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

  export interface LoadField {
    kind: "load_field";
    object: Value;
    field: string;
    fieldIndex: number; // For struct layout
    type: Type;
    dest: string;
    loc?: Ast.SourceLocation;
  }

  export interface StoreField {
    kind: "store_field";
    object: Value;
    field: string;
    fieldIndex: number;
    value: Value;
    loc?: Ast.SourceLocation;
  }

  export interface LoadIndex {
    kind: "load_index";
    array: Value;
    index: Value;
    elementType: Type;
    dest: string;
    loc?: Ast.SourceLocation;
  }

  export interface StoreIndex {
    kind: "store_index";
    array: Value;
    index: Value;
    value: Value;
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

  export interface Call {
    kind: "call";
    function: string; // Function name
    arguments: Value[];
    dest?: string; // Optional for void functions
    loc?: Ast.SourceLocation;
  }

  export interface Length {
    kind: "length";
    object: Value;
    dest: string;
    loc?: Ast.SourceLocation;
  }
}
