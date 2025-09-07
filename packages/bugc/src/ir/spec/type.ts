/**
 * Type references in Ir
 */
export type Type =
  | { kind: "uint"; bits: number }
  | { kind: "int"; bits: number }
  | { kind: "address" }
  | { kind: "bool" }
  | { kind: "bytes"; size?: number } // Optional size for dynamic bytes
  | { kind: "string" }
  | { kind: "array"; element: Type; size?: number }
  | { kind: "mapping"; key: Type; value: Type }
  | { kind: "struct"; name: string; fields: Type.StructField[] };

export namespace Type {
  export interface StructField {
    name: string;
    type: Type;
    offset: number; // Byte offset in memory layout
  }
}
