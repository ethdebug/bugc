/**
 * Type definitions for the BUG language
 */

export type TypeKind =
  | "uint"
  | "int"
  | "address"
  | "bool"
  | "bytes"
  | "string"
  | "array"
  | "mapping"
  | "struct"
  | "function"
  | "error";

export interface Type {
  kind: TypeKind;
  bits?: number; // For numeric and bytes types
  toString(): string;
  equals(other: Type): boolean;
}

// Elementary types
export class ElementaryType implements Type {
  constructor(
    public kind: TypeKind,
    public bits?: number,
  ) {}

  toString(): string {
    if (this.kind === "uint" || this.kind === "int") {
      return `${this.kind}${this.bits || 256}`;
    }
    if (this.kind === "bytes" && this.bits) {
      return `bytes${this.bits / 8}`;
    }
    return this.kind;
  }

  equals(other: Type): boolean {
    return (
      other instanceof ElementaryType &&
      other.kind === this.kind &&
      other.bits === this.bits
    );
  }
}

// Array type
export class ArrayType implements Type {
  kind = "array" as const;

  constructor(
    public elementType: Type,
    public size?: number, // undefined for dynamic arrays
  ) {}

  toString(): string {
    return this.size !== undefined
      ? `array<${this.elementType.toString()}, ${this.size}>`
      : `array<${this.elementType.toString()}>`;
  }

  equals(other: Type): boolean {
    return (
      other instanceof ArrayType &&
      this.elementType.equals(other.elementType) &&
      this.size === other.size
    );
  }
}

// Mapping type
export class MappingType implements Type {
  kind = "mapping" as const;

  constructor(
    public keyType: Type,
    public valueType: Type,
  ) {}

  toString(): string {
    return `mapping<${this.keyType.toString()}, ${this.valueType.toString()}>`;
  }

  equals(other: Type): boolean {
    return (
      other instanceof MappingType &&
      this.keyType.equals(other.keyType) &&
      this.valueType.equals(other.valueType)
    );
  }
}

// Struct type
export class StructType implements Type {
  kind = "struct" as const;

  constructor(
    public name: string,
    public fields: Map<string, Type>,
  ) {}

  toString(): string {
    return this.name;
  }

  equals(other: Type): boolean {
    if (!(other instanceof StructType) || other.name !== this.name) {
      return false;
    }

    if (this.fields.size !== other.fields.size) {
      return false;
    }

    for (const [name, type] of this.fields) {
      const otherType = other.fields.get(name);
      if (!otherType || !type.equals(otherType)) {
        return false;
      }
    }

    return true;
  }

  hasField(name: string): boolean {
    return this.fields.has(name);
  }

  getFieldType(name: string): Type | undefined {
    return this.fields.get(name);
  }
}

// Function type
export class FunctionType implements Type {
  kind = "function" as const;

  constructor(
    public name: string,
    public parameterTypes: Type[],
    public returnType: Type | null, // null for void functions
  ) {}

  toString(): string {
    const params = this.parameterTypes.map((t) => t.toString()).join(", ");
    const ret = this.returnType ? ` -> ${this.returnType.toString()}` : "";
    return `function(${params})${ret}`;
  }

  equals(other: Type): boolean {
    if (!(other instanceof FunctionType)) {
      return false;
    }

    if (this.parameterTypes.length !== other.parameterTypes.length) {
      return false;
    }

    for (let i = 0; i < this.parameterTypes.length; i++) {
      if (!this.parameterTypes[i].equals(other.parameterTypes[i])) {
        return false;
      }
    }

    if (this.returnType && other.returnType) {
      return this.returnType.equals(other.returnType);
    }

    return this.returnType === other.returnType;
  }
}

// Error type for type checking failures
export class ErrorType implements Type {
  kind = "error" as const;

  constructor(public message: string) {}

  toString(): string {
    return `<error: ${this.message}>`;
  }

  equals(other: Type): boolean {
    return other instanceof ErrorType;
  }
}
