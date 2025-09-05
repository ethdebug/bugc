/**
 * BUG-Ir (Intermediate Representation) type definitions
 *
 * The Ir is designed to:
 * - Represent BUG programs in a lower-level form suitable for optimization and
 *   code generation
 * - Maintain source location information through transformations
 * - Support control flow analysis and basic block construction
 * - Be easily translatable to EVM bytecode
 */

import { SourceLocation } from "../ast";

/**
 * Top-level Ir module representing a complete BUG program
 */
export interface IrModule {
  /** Program name from 'name' declaration */
  name: string;
  /** Storage layout information */
  storage: StorageLayout;
  /** User-defined functions */
  functions: Map<string, IrFunction>;
  /** Constructor function (optional, for contract creation) */
  create?: IrFunction;
  /** The main code function (runtime code) */
  main: IrFunction;
  /** Source location of the program */
  loc?: SourceLocation;
}

/**
 * Storage layout information
 */
export interface StorageLayout {
  /** Storage slot assignments */
  slots: StorageSlot[];
}

export interface StorageSlot {
  /** Slot number */
  slot: number;
  /** Variable name */
  name: string;
  /** Type of the storage variable */
  type: TypeRef;
  /** Source location */
  loc?: SourceLocation;
}

/**
 * Ir function containing basic blocks
 */
export interface IrFunction {
  /** Function name (for debugging) */
  name: string;
  /** Local variables (parameters first, then local vars) */
  locals: LocalVariable[];
  /** Number of parameters (first N locals are parameters) */
  paramCount?: number;
  /** Entry block ID */
  entry: string;
  /** All basic blocks in the function */
  blocks: Map<string, BasicBlock>;
}

/**
 * Local variable declaration
 */
export interface LocalVariable {
  /** Variable name */
  name: string;
  /** Variable type */
  type: TypeRef;
  /** Unique ID for this variable */
  id: string;
  /** Source location of declaration */
  loc?: SourceLocation;
}

/**
 * Basic block - sequence of instructions with single entry/exit
 */
export interface BasicBlock {
  /** Unique block ID */
  id: string;
  /** Phi nodes must be at the beginning of the block */
  phis: PhiInstruction[];
  /** Instructions in execution order (after phi nodes) */
  instructions: IrInstruction[];
  /** Terminal instruction (jump, conditional jump, or return) */
  terminator: Terminator;
  /** Predecessor block IDs (for CFG construction) */
  predecessors: Set<string>;
  /** Source location (e.g., for if/while blocks) */
  loc?: SourceLocation;
}

/**
 * Block terminator instructions
 */
export type Terminator =
  | { kind: "jump"; target: string; loc?: SourceLocation }
  | {
      kind: "branch";
      condition: Value;
      trueTarget: string;
      falseTarget: string;
      loc?: SourceLocation;
    }
  | { kind: "return"; value?: Value; loc?: SourceLocation };

/**
 * Ir instruction types
 */
export type IrInstruction =
  // Constants
  | ConstInstruction
  // Storage operations
  | LoadStorageInstruction
  | StoreStorageInstruction
  | LoadMappingInstruction
  | StoreMappingInstruction
  // Storage slot computation
  | ComputeSlotInstruction
  | ComputeArraySlotInstruction
  | ComputeFieldOffsetInstruction
  // Local variable operations
  | LoadLocalInstruction
  | StoreLocalInstruction
  // Struct field operations
  | LoadFieldInstruction
  | StoreFieldInstruction
  // Array operations
  | LoadIndexInstruction
  | StoreIndexInstruction
  // Slice operations
  | SliceInstruction
  // Arithmetic and logic
  | BinaryOpInstruction
  | UnaryOpInstruction
  // Environment access
  | EnvInstruction
  // Type operations
  | HashInstruction
  | CastInstruction
  // Function calls
  | CallInstruction
  // Length operations
  | LengthInstruction;

// Instruction definitions
export interface ConstInstruction {
  kind: "const";
  value: bigint | string | boolean;
  type: TypeRef;
  dest: string;
  loc?: SourceLocation;
}

export interface LoadStorageInstruction {
  kind: "load_storage";
  slot: Value; // Can be constant or computed
  type: TypeRef;
  dest: string;
  loc?: SourceLocation;
}

export interface StoreStorageInstruction {
  kind: "store_storage";
  slot: Value; // Can be constant or computed
  value: Value;
  loc?: SourceLocation;
}

export interface LoadMappingInstruction {
  kind: "load_mapping";
  slot: number;
  key: Value;
  valueType: TypeRef;
  dest: string;
  loc?: SourceLocation;
}

export interface StoreMappingInstruction {
  kind: "store_mapping";
  slot: number;
  key: Value;
  value: Value;
  loc?: SourceLocation;
}

export interface ComputeSlotInstruction {
  kind: "compute_slot";
  baseSlot: Value; // Base storage slot (or computed slot for nested mappings)
  key: Value; // Mapping key
  keyType: TypeRef; // Type of the key for proper encoding
  dest: string;
  loc?: SourceLocation;
}

export interface ComputeArraySlotInstruction {
  kind: "compute_array_slot";
  baseSlot: Value; // Array base storage slot
  dest: string;
  loc?: SourceLocation;
}

export interface ComputeFieldOffsetInstruction {
  kind: "compute_field_offset";
  baseSlot: Value; // Base slot (struct start)
  fieldIndex: number; // Field index in the struct
  dest: string;
  loc?: SourceLocation;
}

export interface LoadLocalInstruction {
  kind: "load_local";
  local: string;
  dest: string;
  loc?: SourceLocation;
}

export interface StoreLocalInstruction {
  kind: "store_local";
  local: string;
  localType: TypeRef; // The declared type of the local variable
  value: Value;
  loc?: SourceLocation;
}

export interface LoadFieldInstruction {
  kind: "load_field";
  object: Value;
  field: string;
  fieldIndex: number; // For struct layout
  type: TypeRef;
  dest: string;
  loc?: SourceLocation;
}

export interface StoreFieldInstruction {
  kind: "store_field";
  object: Value;
  field: string;
  fieldIndex: number;
  value: Value;
  loc?: SourceLocation;
}

export interface LoadIndexInstruction {
  kind: "load_index";
  array: Value;
  index: Value;
  elementType: TypeRef;
  dest: string;
  loc?: SourceLocation;
}

export interface StoreIndexInstruction {
  kind: "store_index";
  array: Value;
  index: Value;
  value: Value;
  loc?: SourceLocation;
}

export interface SliceInstruction {
  kind: "slice";
  object: Value;
  start: Value;
  end: Value;
  dest: string;
  loc?: SourceLocation;
}

export interface BinaryOpInstruction {
  kind: "binary";
  op: BinaryOp;
  left: Value;
  right: Value;
  dest: string;
  loc?: SourceLocation;
}

export interface UnaryOpInstruction {
  kind: "unary";
  op: UnaryOp;
  operand: Value;
  dest: string;
  loc?: SourceLocation;
}

export interface EnvInstruction {
  kind: "env";
  op: EnvOp;
  dest: string;
  loc?: SourceLocation;
}

export interface HashInstruction {
  kind: "hash";
  value: Value;
  dest: string;
  loc?: SourceLocation;
}

export interface CastInstruction {
  kind: "cast";
  value: Value;
  targetType: TypeRef;
  dest: string;
  loc?: SourceLocation;
}

export interface CallInstruction {
  kind: "call";
  function: string; // Function name
  arguments: Value[];
  dest?: string; // Optional for void functions
  loc?: SourceLocation;
}

export interface LengthInstruction {
  kind: "length";
  object: Value;
  dest: string;
  loc?: SourceLocation;
}

export interface PhiInstruction {
  kind: "phi";
  /** Map from predecessor block ID to value */
  sources: Map<string, Value>;
  /** Destination temp to assign the phi result */
  dest: string;
  /** Type of the phi node (all sources must have same type) */
  type: TypeRef;
  loc?: SourceLocation;
}

/**
 * Binary operators
 */
export type BinaryOp =
  // Arithmetic
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

/**
 * Unary operators
 */
export type UnaryOp = "not" | "neg";

/**
 * Environment operations
 */
export type EnvOp =
  | "msg_sender"
  | "msg_value"
  | "msg_data"
  | "block_number"
  | "block_timestamp";

/**
 * Ir value - either a constant or a reference to a temporary/local
 */
export type Value =
  | { kind: "const"; value: bigint | string | boolean; type: TypeRef }
  | { kind: "temp"; id: string; type: TypeRef }
  | { kind: "local"; name: string; type: TypeRef };

/**
 * Type references in Ir
 */
export type TypeRef =
  | { kind: "uint"; bits: number }
  | { kind: "int"; bits: number }
  | { kind: "address" }
  | { kind: "bool" }
  | { kind: "bytes"; size?: number } // Optional size for dynamic bytes
  | { kind: "string" }
  | { kind: "array"; element: TypeRef; size?: number }
  | { kind: "mapping"; key: TypeRef; value: TypeRef }
  | { kind: "struct"; name: string; fields: StructField[] };

export interface StructField {
  name: string;
  type: TypeRef;
  offset: number; // Byte offset in memory layout
}

/**
 * Helper to create temporary value references
 */
export function temp(id: string, type: TypeRef): Value {
  return { kind: "temp", id, type };
}

/**
 * Helper to create constant values
 */
export function constant(
  value: bigint | string | boolean,
  type: TypeRef,
): Value {
  return { kind: "const", value, type };
}

/**
 * Helper to create local value references
 */
export function local(name: string, type: TypeRef): Value {
  return { kind: "local", name, type };
}
