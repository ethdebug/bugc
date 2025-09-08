/**
 * Type definitions for the BUG language
 */

export interface Type {
  kind: Type.Kind;
  bits?: number; // For numeric and bytes types
  toString(): string;
  equals(other: Type): boolean;
}

export namespace Type {
  export type Kind =
    | Type.Elementary.Kind
    | Type.Array.Kind
    | Type.Mapping.Kind
    | Type.Struct.Kind
    | Type.Function.Kind
    | Type.Failure.Kind;

  // Elementary types
  export class Elementary implements Type {
    constructor(
      public kind: Type.Kind,
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
        other instanceof Type.Elementary &&
        other.kind === this.kind &&
        other.bits === this.bits
      );
    }
  }

  export const isElementary = (type: Type): type is Type.Elementary =>
    type instanceof Type.Elementary;

  export namespace Elementary {
    export type Kind = "uint" | "int" | "address" | "bool" | "bytes" | "string";

    // Singleton instances for elementary types
    export const uint256 = new Type.Elementary("uint", 256);
    export const uint128 = new Type.Elementary("uint", 128);
    export const uint64 = new Type.Elementary("uint", 64);
    export const uint32 = new Type.Elementary("uint", 32);
    export const uint16 = new Type.Elementary("uint", 16);
    export const uint8 = new Type.Elementary("uint", 8);
    export const int256 = new Type.Elementary("int", 256);
    export const int128 = new Type.Elementary("int", 128);
    export const int64 = new Type.Elementary("int", 64);
    export const int32 = new Type.Elementary("int", 32);
    export const int16 = new Type.Elementary("int", 16);
    export const int8 = new Type.Elementary("int", 8);
    export const address = new Type.Elementary("address");
    export const bool = new Type.Elementary("bool");
    export const bytes = new Type.Elementary("bytes"); // Dynamic bytes
    export const bytes32 = new Type.Elementary("bytes", 256);
    export const bytes16 = new Type.Elementary("bytes", 128);
    export const bytes8 = new Type.Elementary("bytes", 64);
    export const bytes4 = new Type.Elementary("bytes", 32);
    export const string = new Type.Elementary("string");

    const makeIsKind =
      <K extends Type.Elementary.Kind>(kind: K) =>
      (type: Type.Elementary): type is Type.Elementary & { kind: K } =>
        type.kind === kind;

    export const isUint = makeIsKind("uint" as const);
    export const isInt = makeIsKind("int" as const);
    export const isAddress = makeIsKind("address" as const);
    export const isBool = makeIsKind("bool" as const);
    export const isBytes = makeIsKind("bytes" as const);
    export const isString = makeIsKind("string" as const);

    export const isNumeric = (type: Type.Elementary) =>
      Type.Elementary.isUint(type) || Type.Elementary.isInt(type);

    export namespace Bytes {
      export const isDynamic = (
        type: Type.Elementary & { kind: "bytes" },
      ): type is Type.Elementary & { kind: "bytes" } & { bits?: undefined } =>
        !("bits" in type) || type.bits === undefined;
    }
  }

  export class Array implements Type {
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
        other instanceof Type.Array &&
        this.elementType.equals(other.elementType) &&
        this.size === other.size
      );
    }
  }

  export const isArray = (type: Type): type is Type.Array =>
    type instanceof Type.Array;

  export namespace Array {
    export type Kind = "array";
  }

  // Mapping type
  export class Mapping implements Type {
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
        other instanceof Type.Mapping &&
        this.keyType.equals(other.keyType) &&
        this.valueType.equals(other.valueType)
      );
    }
  }

  export const isMapping = (type: Type): type is Type.Mapping =>
    type instanceof Type.Mapping;

  export namespace Mapping {
    export type Kind = "mapping";
  }

  export class Struct implements Type {
    kind = "struct" as const;

    constructor(
      public name: string,
      public fields: Map<string, Type>,
    ) {}

    toString(): string {
      return this.name;
    }

    equals(other: Type): boolean {
      if (!(other instanceof Type.Struct) || other.name !== this.name) {
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

  export const isStruct = (type: Type): type is Type.Struct =>
    type instanceof Type.Struct;

  export namespace Struct {
    export type Kind = "struct";
  }

  // Function type
  export class Function implements Type {
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
      if (!(other instanceof Type.Function)) {
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

  export const isFunction = (type: Type): type is Type.Function =>
    type instanceof Type.Function;

  export namespace Function {
    export type Kind = "function";
  }

  // Error type for type checking failures
  export class Failure implements Type {
    kind = "fail" as const;

    constructor(public message: string) {}

    toString(): string {
      return `<error: ${this.message}>`;
    }

    equals(other: Type): boolean {
      return other instanceof Type.Failure;
    }
  }

  export const isFailure = (type: Type): type is Type.Failure =>
    type instanceof Type.Failure;

  export namespace Failure {
    export type Kind = "fail";
  }
}
