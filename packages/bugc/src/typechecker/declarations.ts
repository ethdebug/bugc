import * as Ast from "#ast";
import { Type } from "#types";
import { Result } from "#result";
import { Error as TypeError, ErrorCode, ErrorMessages } from "./errors.js";

export interface Declarations {
  readonly structs: Map<string, Type.Struct>;
  readonly functions: Map<string, Type.Function>;
}

/**
 * Collects all type declarations from a program without traversing expressions.
 * This includes struct definitions and function signatures.
 */
export function collectDeclarations(
  program: Ast.Program,
): Result<Declarations, TypeError> {
  const structs = new Map<string, Type.Struct>();
  const functions = new Map<string, Type.Function>();
  const errors: TypeError[] = [];

  // First pass: collect all struct types
  for (const decl of program.declarations) {
    if (Ast.Declaration.isStruct(decl)) {
      try {
        const structType = buildStructType(decl, structs);
        structs.set(decl.name, structType);
      } catch (e) {
        if (e instanceof TypeError) {
          errors.push(e);
        }
      }
    }
  }

  // Second pass: collect function signatures (may reference structs)
  for (const decl of program.declarations) {
    if (Ast.Declaration.isFunction(decl)) {
      try {
        const funcType = buildFunctionSignature(decl, structs);
        functions.set(decl.name, funcType);
      } catch (e) {
        if (e instanceof TypeError) {
          errors.push(e);
        }
      }
    }
  }

  if (errors.length > 0) {
    return Result.err(errors);
  }
  return Result.ok({ structs, functions });
}

/**
 * Builds a Type.Struct from a struct declaration
 */
function buildStructType(
  decl: Ast.Declaration.Struct,
  existingStructs: Map<string, Type.Struct>,
): Type.Struct {
  const fields = new Map<string, Type>();

  for (const field of decl.fields) {
    if (field.kind === "field" && field.declaredType) {
      const fieldType = resolveType(field.declaredType, existingStructs);
      fields.set(field.name, fieldType);
    }
  }

  return Type.struct(decl.name, fields);
}

/**
 * Builds a Type.Function from a function declaration
 */
function buildFunctionSignature(
  decl: Ast.Declaration.Function,
  structTypes: Map<string, Type.Struct>,
): Type.Function {
  // Resolve parameter types
  const parameterTypes: Type[] = [];
  for (const param of decl.parameters) {
    const paramType = resolveType(param.type, structTypes);
    parameterTypes.push(paramType);
  }

  // Resolve return type (null for void functions)
  const returnType = decl.returnType
    ? resolveType(decl.returnType, structTypes)
    : null;

  return Type.function_(parameterTypes, returnType, decl.name);
}

/**
 * Resolves an AST type node to a Type object
 */
export function resolveType(
  typeNode: Ast.Type,
  structTypes: Map<string, Type.Struct>,
): Type {
  switch (typeNode.type) {
    case "ElementaryType": {
      // Map elementary types based on kind and bits
      if (typeNode.kind === "uint") {
        const typeMap: Record<number, Type> = {
          256: Type.Elementary.uint(256),
          128: Type.Elementary.uint(128),
          64: Type.Elementary.uint(64),
          32: Type.Elementary.uint(32),
          16: Type.Elementary.uint(16),
          8: Type.Elementary.uint(8),
        };
        return (
          typeMap[typeNode.bits || 256] ||
          Type.failure(`Unknown uint size: ${typeNode.bits}`)
        );
      } else if (typeNode.kind === "int") {
        const typeMap: Record<number, Type> = {
          256: Type.Elementary.int(256),
          128: Type.Elementary.int(128),
          64: Type.Elementary.int(64),
          32: Type.Elementary.int(32),
          16: Type.Elementary.int(16),
          8: Type.Elementary.int(8),
        };
        return (
          typeMap[typeNode.bits || 256] ||
          Type.failure(`Unknown int size: ${typeNode.bits}`)
        );
      } else if (typeNode.kind === "bytes") {
        if (!typeNode.bits) {
          return Type.Elementary.bytes(); // Dynamic bytes
        }
        // typeNode.bits now contains the byte size directly (e.g., 32 for bytes32)
        const validSizes = [4, 8, 16, 32];
        if (validSizes.includes(typeNode.bits)) {
          return Type.Elementary.bytes(typeNode.bits);
        } else {
          return Type.failure(`Unknown bytes size: ${typeNode.bits}`);
        }
      } else if (typeNode.kind === "address") {
        return Type.Elementary.address();
      } else if (typeNode.kind === "bool") {
        return Type.Elementary.bool();
      } else if (typeNode.kind === "string") {
        return Type.Elementary.string();
      }
      return Type.failure(`Unknown elementary type: ${typeNode.kind}`);
    }

    case "ComplexType":
      if (typeNode.kind === "array") {
        const elementType = resolveType(typeNode.typeArgs![0], structTypes);
        return Type.array(elementType, typeNode.size);
      } else if (typeNode.kind === "mapping") {
        const keyType = resolveType(typeNode.typeArgs![0], structTypes);
        const valueType = resolveType(typeNode.typeArgs![1], structTypes);
        return Type.mapping(keyType, valueType);
      } else {
        return Type.failure(`Unsupported complex type: ${typeNode.kind}`);
      }

    case "ReferenceType": {
      const structType = structTypes.get(typeNode.name);
      if (!structType) {
        throw new TypeError(
          ErrorMessages.UNDEFINED_TYPE(typeNode.name),
          typeNode.loc || undefined,
          undefined,
          undefined,
          ErrorCode.UNDEFINED_TYPE,
        );
      }
      return structType;
    }

    default:
      return Type.failure("Unknown type");
  }
}
