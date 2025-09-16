import * as Ir from "#ir";
import { Type } from "#types";
import { Error as IrgenError, ErrorCode } from "./errors.js";
import { Severity } from "#result";

export function mapTypeToIrType(type: Type): Ir.Type {
  if (Type.isArray(type)) {
    return {
      kind: "array",
      element: mapTypeToIrType(type.element),
      size: type.size,
    };
  }

  if (Type.isMapping(type)) {
    return {
      kind: "mapping",
      key: mapTypeToIrType(type.key),
      value: mapTypeToIrType(type.value),
    };
  }

  if (Type.isStruct(type)) {
    const fields: Ir.Type.StructField[] = [];
    let offset = 0;
    for (const [name, fieldType] of type.fields) {
      fields.push({
        name,
        type: mapTypeToIrType(fieldType),
        offset,
      });
      offset += 32; // Simple layout: 32 bytes per field
    }
    return {
      kind: "struct",
      name: type.name,
      fields,
    };
  }

  if (Type.isFailure(type)) {
    // Error type should already have diagnostics added elsewhere
    return { kind: "uint", bits: 256 }; // Default fallback for error case
  }

  if (Type.isFunction(type)) {
    // Function types are not directly convertible to IR types
    // This shouldn't happen in normal code generation
    throw new IrgenError(
      `Cannot convert function type to IR type`,
      undefined,
      Severity.Error,
      ErrorCode.UNKNOWN_TYPE,
    );
  }

  if (Type.isElementary(type)) {
    switch (type.kind) {
      case "uint":
        return { kind: "uint", bits: type.bits || 256 };
      case "int":
        return { kind: "uint", bits: type.bits || 256 }; // BUG language doesn't have signed ints
      case "address":
        return { kind: "address" };
      case "bool":
        return { kind: "bool" };
      case "bytes":
        return type.bits
          ? { kind: "bytes", size: type.bits / 8 }
          : { kind: "bytes" };
      case "string":
        return { kind: "string" };
      default:
        throw new IrgenError(
          // @ts-expect-error switch is exhaustive
          `Unknown elementary type: ${type.kind}`,
          undefined,
          Severity.Error,
          ErrorCode.UNKNOWN_TYPE,
        );
    }
  }

  throw new IrgenError(
    `Unknown type: ${type}`,
    undefined,
    Severity.Error,
    ErrorCode.UNKNOWN_TYPE,
  );
}
// function mapTypeToIrType(type: Type): Ir.Type {
//   if (!type) {
//     return { kind: "uint", bits: 256 };
//   }

//   // The type is from the types module, not an AST type
//   switch (type.kind) {
//     case "uint":
//       return { kind: "uint", bits: type.bits || 256 };
//     case "int":
//       return { kind: "int", bits: type.bits || 256 };
//     case "bool":
//       return { kind: "bool" };
//     case "address":
//       return { kind: "address" };
//     case "bytes":
//       return { kind: "bytes", size: type.bits ? type.bits / 8 : 32 };
//     case "string":
//       return { kind: "bytes", size: 32 }; // Simplified
//     case "array": {
//       const arrayType = type as Type.Array;
//       return {
//         kind: "array",
//         element: mapTypeToIrType(arrayType.element),
//         size: arrayType.size,
//       } as Ir.Type;
//     }
//     case "mapping": {
//       const mappingType = type as Type.Mapping;
//       return {
//         kind: "mapping",
//         key: mapTypeToIrType(mappingType.key),
//         value: mapTypeToIrType(mappingType.value),
//       } as Ir.Type;
//     }
//     case "struct": {
//       const structType = type as Type.Struct;
//       const fields: Ir.Type.StructField[] = [];
//       let offset = 0;
//       for (const [name, fieldType] of structType.fields) {
//         fields.push({
//           name,
//           type: mapTypeToIrType(fieldType),
//           offset,
//         });
//         offset += 32; // Simplified - each field takes 32 bytes
//       }
//       return {
//         kind: "struct",
//         name: structType.name,
//         fields,
//       } as Ir.Type;
//     }
//     default:
//       return { kind: "uint", bits: 256 };
//   }
// }
