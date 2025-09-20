import * as Ir from "#ir";
import { Type as BugType } from "#types";
import { Error as IrgenError, ErrorCode, assertExhausted } from "./errors.js";
import { Severity } from "#result";

export function fromBugType(type: BugType): Ir.Type {
  if (BugType.isFailure(type) || BugType.isFunction(type)) {
    // Error type should already have diagnostics added elsewhere
    throw new IrgenError(
      `Cannot convert type with kind ${type.kind} to IR type`,
      undefined,
      Severity.Error,
      ErrorCode.UNKNOWN_TYPE,
    );
  }

  if (BugType.isArray(type)) {
    return {
      kind: "array",
      element: fromBugType(type.element),
      size: type.size,
    };
  }

  if (BugType.isMapping(type)) {
    return {
      kind: "mapping",
      key: fromBugType(type.key),
      value: fromBugType(type.value),
    };
  }

  if (BugType.isStruct(type)) {
    const fields: Ir.Type.StructField[] = [];
    let offset = 0;
    for (const [name, fieldType] of type.fields) {
      fields.push({
        name,
        type: fromBugType(fieldType),
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

  if (BugType.isElementary(type)) {
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
        return type.size
          ? { kind: "bytes", size: type.size }
          : { kind: "bytes" };
      case "string":
        return { kind: "string" };
      default:
        assertExhausted(type);
    }
  }

  assertExhausted(type);
}
