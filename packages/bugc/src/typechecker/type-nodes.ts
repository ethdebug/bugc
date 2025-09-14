import * as Ast from "#ast";
import { Type } from "#types";
import type { Visitor } from "#ast";
import type { Context, Report } from "./context.js";
import { Error as TypeError, ErrorCode, ErrorMessages } from "./errors.js";

/**
 * Type checker for type AST nodes.
 * These nodes appear in declarations and casts.
 * They resolve to Type objects.
 */
export const typeNodeChecker: Pick<
  Visitor<Report, Context>,
  "elementaryType" | "complexType" | "referenceType"
> = {
  elementaryType(node: Ast.Type.Elementary, context: Context): Report {
    const errors: TypeError[] = [];
    const nodeTypes = new Map(context.nodeTypes);
    let type: Type | undefined;

    // Map elementary types based on kind and bits
    if (node.kind === "uint") {
      const typeMap: Record<number, Type> = {
        256: Type.Elementary.uint(256),
        128: Type.Elementary.uint(128),
        64: Type.Elementary.uint(64),
        32: Type.Elementary.uint(32),
        16: Type.Elementary.uint(16),
        8: Type.Elementary.uint(8),
      };
      type =
        typeMap[node.bits || 256] ||
        Type.failure(`Unknown uint size: ${node.bits}`);
    } else if (node.kind === "int") {
      const typeMap: Record<number, Type> = {
        256: Type.Elementary.int(256),
        128: Type.Elementary.int(128),
        64: Type.Elementary.int(64),
        32: Type.Elementary.int(32),
        16: Type.Elementary.int(16),
        8: Type.Elementary.int(8),
      };
      type =
        typeMap[node.bits || 256] ||
        Type.failure(`Unknown int size: ${node.bits}`);
    } else if (node.kind === "bytes") {
      if (!node.bits) {
        type = Type.Elementary.bytes(); // Dynamic bytes
      } else {
        const typeMap: Record<number, Type> = {
          256: Type.Elementary.bytes(32),
          128: Type.Elementary.bytes(16),
          64: Type.Elementary.bytes(8),
          32: Type.Elementary.bytes(4),
        };
        type =
          typeMap[node.bits] ||
          Type.failure(`Unknown bytes size: ${node.bits}`);
      }
    } else if (node.kind === "address") {
      type = Type.Elementary.address();
    } else if (node.kind === "bool") {
      type = Type.Elementary.bool();
    } else if (node.kind === "string") {
      type = Type.Elementary.string();
    } else {
      type = Type.failure(`Unknown elementary type: ${node.kind}`);
    }

    if (type) {
      nodeTypes.set(node.id, type);
    }

    return {
      type,
      symbols: context.symbols,
      nodeTypes,
      errors,
    };
  },

  complexType(node: Ast.Type.Complex, context: Context): Report {
    const errors: TypeError[] = [];
    let nodeTypes = new Map(context.nodeTypes);
    let symbols = context.symbols;
    let type: Type | undefined;

    if (node.kind === "array") {
      // Resolve element type
      const elementContext: Context = {
        ...context,
        nodeTypes,
        symbols,
        pointer: context.pointer + "/typeArgs/0",
      };
      const elementResult = Ast.visit(
        context.visitor,
        node.typeArgs![0],
        elementContext,
      );
      nodeTypes = elementResult.nodeTypes;
      symbols = elementResult.symbols;
      errors.push(...elementResult.errors);

      if (elementResult.type) {
        type = Type.array(elementResult.type, node.size);
      }
    } else if (node.kind === "mapping") {
      // Resolve key type
      const keyContext: Context = {
        ...context,
        nodeTypes,
        symbols,
        pointer: context.pointer + "/typeArgs/0",
      };
      const keyResult = Ast.visit(
        context.visitor,
        node.typeArgs![0],
        keyContext,
      );
      nodeTypes = keyResult.nodeTypes;
      symbols = keyResult.symbols;
      errors.push(...keyResult.errors);

      // Resolve value type
      const valueContext: Context = {
        ...context,
        nodeTypes,
        symbols,
        pointer: context.pointer + "/typeArgs/1",
      };
      const valueResult = Ast.visit(
        context.visitor,
        node.typeArgs![1],
        valueContext,
      );
      nodeTypes = valueResult.nodeTypes;
      symbols = valueResult.symbols;
      errors.push(...valueResult.errors);

      if (keyResult.type && valueResult.type) {
        type = Type.mapping(keyResult.type, valueResult.type);
      }
    } else {
      type = Type.failure(`Unsupported complex type: ${node.kind}`);
    }

    if (type) {
      nodeTypes.set(node.id, type);
    }

    return {
      type,
      symbols,
      nodeTypes,
      errors,
    };
  },

  referenceType(node: Ast.Type.Reference, context: Context): Report {
    const errors: TypeError[] = [];
    const nodeTypes = new Map(context.nodeTypes);
    let type: Type | undefined;

    const structType = context.structs.get(node.name);
    if (!structType) {
      const error = new TypeError(
        ErrorMessages.UNDEFINED_TYPE(node.name),
        node.loc || undefined,
        undefined,
        undefined,
        ErrorCode.UNDEFINED_TYPE,
      );
      errors.push(error);
      type = Type.failure(`Undefined struct: ${node.name}`);
    } else {
      type = structType;
    }

    if (type) {
      nodeTypes.set(node.id, type);
    }

    return {
      type,
      symbols: context.symbols,
      nodeTypes,
      errors,
    };
  },
};
