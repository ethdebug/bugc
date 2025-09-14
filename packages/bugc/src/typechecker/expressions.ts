import * as Ast from "#ast";
import { Type } from "#types";
import type { Visitor } from "#ast";
import type { Context, Report } from "./context.js";
import { Error as TypeError, ErrorCode, ErrorMessages } from "./errors.js";
import { isAssignable, commonType } from "./assignable.js";

/**
 * Type checker for expression nodes.
 * Each expression method computes the type of the expression
 * and returns it in the report.
 */
export const expressionChecker: Pick<
  Visitor<Report, Context>,
  | "identifierExpression"
  | "callExpression"
  | "castExpression"
  | "accessExpression"
  | "literalExpression"
  | "specialExpression"
  | "operatorExpression"
> = {
  identifierExpression(
    node: Ast.Expression.Identifier,
    context: Context,
  ): Report {
    const errors: TypeError[] = [];
    const nodeTypes = new Map(context.nodeTypes);

    const symbol = context.symbols.lookup(node.name);
    if (!symbol) {
      const error = new TypeError(
        ErrorMessages.UNDEFINED_VARIABLE(node.name),
        node.loc || undefined,
        undefined,
        undefined,
        ErrorCode.UNDEFINED_VARIABLE,
      );
      errors.push(error);
      return {
        type: undefined,
        symbols: context.symbols,
        nodeTypes,
        errors,
      };
    }

    nodeTypes.set(node.id, symbol.type);
    return {
      type: symbol.type,
      symbols: context.symbols,
      nodeTypes,
      errors,
    };
  },

  literalExpression(node: Ast.Expression.Literal, context: Context): Report {
    const nodeTypes = new Map(context.nodeTypes);
    let type: Type | undefined;

    switch (node.kind) {
      case "number":
        type = Type.Elementary.uint(256);
        break;
      case "boolean":
        type = Type.Elementary.bool();
        break;
      case "string":
        type = Type.Elementary.string();
        break;
      case "address":
        type = Type.Elementary.address();
        break;
      case "hex": {
        // Determine bytes type based on hex literal length
        // Remove 0x prefix if present
        const hexValue = node.value.startsWith("0x")
          ? node.value.slice(2)
          : node.value;

        // Each byte is 2 hex characters
        const byteCount = Math.ceil(hexValue.length / 2);

        // For fixed-size bytes types (bytes1 to bytes32)
        if (byteCount > 0 && byteCount <= 32) {
          type = Type.Elementary.bytes(byteCount * 8);
        } else {
          // For larger hex literals, use dynamic bytes
          type = Type.Elementary.bytes();
        }
        break;
      }
    }

    if (type) {
      nodeTypes.set(node.id, type);
    }

    return {
      type,
      symbols: context.symbols,
      nodeTypes,
      errors: [],
    };
  },

  operatorExpression(node: Ast.Expression.Operator, context: Context): Report {
    const errors: TypeError[] = [];
    let nodeTypes = new Map(context.nodeTypes);
    let symbols = context.symbols;

    // Type check all operands
    const operandTypes: Type[] = [];
    for (let i = 0; i < node.operands.length; i++) {
      const operandContext: Context = {
        ...context,
        nodeTypes,
        symbols,
        pointer: context.pointer + "/operands/" + i,
      };
      const operandResult = Ast.visit(
        context.visitor,
        node.operands[i],
        operandContext,
      );
      nodeTypes = operandResult.nodeTypes;
      symbols = operandResult.symbols;
      errors.push(...operandResult.errors);
      if (operandResult.type) {
        operandTypes.push(operandResult.type);
      }
    }

    // If any operand failed to type check, bail out
    if (operandTypes.length !== node.operands.length) {
      return { symbols, nodeTypes, errors };
    }

    let resultType: Type | undefined;

    if (node.operands.length === 1) {
      // Unary operator
      const operandType = operandTypes[0];

      switch (node.operator) {
        case "!":
          if (!Type.Elementary.isBool(operandType)) {
            const error = new TypeError(
              ErrorMessages.INVALID_UNARY_OP("!", "boolean"),
              node.loc || undefined,
              undefined,
              undefined,
              ErrorCode.INVALID_OPERAND,
            );
            errors.push(error);
          }
          resultType = Type.Elementary.bool();
          break;

        case "-":
          if (
            !Type.isElementary(operandType) ||
            !Type.Elementary.isNumeric(operandType)
          ) {
            const error = new TypeError(
              ErrorMessages.INVALID_UNARY_OP("-", "numeric"),
              node.loc || undefined,
              undefined,
              undefined,
              ErrorCode.INVALID_OPERAND,
            );
            errors.push(error);
          }
          resultType = operandType;
          break;

        default: {
          const error = new TypeError(
            `Unknown unary operator: ${node.operator}`,
            node.loc || undefined,
            undefined,
            undefined,
            ErrorCode.INVALID_OPERATION,
          );
          errors.push(error);
          break;
        }
      }
    } else if (node.operands.length === 2) {
      // Binary operator
      const [leftType, rightType] = operandTypes;

      switch (node.operator) {
        case "+":
        case "-":
        case "*":
        case "/":
          if (
            !Type.isElementary(leftType) ||
            !Type.isElementary(rightType) ||
            !Type.Elementary.isNumeric(leftType) ||
            !Type.Elementary.isNumeric(rightType)
          ) {
            const error = new TypeError(
              ErrorMessages.INVALID_BINARY_OP(node.operator, "numeric"),
              node.loc || undefined,
              undefined,
              undefined,
              ErrorCode.INVALID_OPERAND,
            );
            errors.push(error);
          }
          resultType = commonType(leftType, rightType) || undefined;
          break;

        case "<":
        case ">":
        case "<=":
        case ">=":
          if (
            !Type.isElementary(leftType) ||
            !Type.isElementary(rightType) ||
            !Type.Elementary.isNumeric(leftType) ||
            !Type.Elementary.isNumeric(rightType)
          ) {
            const error = new TypeError(
              ErrorMessages.INVALID_BINARY_OP(node.operator, "numeric"),
              node.loc || undefined,
              undefined,
              undefined,
              ErrorCode.INVALID_OPERAND,
            );
            errors.push(error);
          }
          resultType = Type.Elementary.bool();
          break;

        case "==":
        case "!=":
          if (!isAssignable(leftType, rightType)) {
            const error = new TypeError(
              `Cannot compare ${Type.format(leftType)} with ${Type.format(rightType)}`,
              node.loc || undefined,
              undefined,
              undefined,
              ErrorCode.INVALID_OPERATION,
            );
            errors.push(error);
          }
          resultType = Type.Elementary.bool();
          break;

        case "&&":
        case "||":
          if (
            !Type.Elementary.isBool(leftType) ||
            !Type.Elementary.isBool(rightType)
          ) {
            const error = new TypeError(
              ErrorMessages.INVALID_BINARY_OP(node.operator, "boolean"),
              node.loc || undefined,
              undefined,
              undefined,
              ErrorCode.INVALID_OPERAND,
            );
            errors.push(error);
          }
          resultType = Type.Elementary.bool();
          break;

        default: {
          const error = new TypeError(
            `Unknown binary operator: ${node.operator}`,
            node.loc || undefined,
            undefined,
            undefined,
            ErrorCode.INVALID_OPERATION,
          );
          errors.push(error);
          break;
        }
      }
    } else {
      const error = new TypeError(
        `Invalid operator arity: ${node.operands.length}`,
        node.loc || undefined,
        undefined,
        undefined,
        ErrorCode.INVALID_OPERATION,
      );
      errors.push(error);
    }

    if (resultType) {
      nodeTypes.set(node.id, resultType);
    }

    return {
      type: resultType,
      symbols,
      nodeTypes,
      errors,
    };
  },

  accessExpression(node: Ast.Expression.Access, context: Context): Report {
    const errors: TypeError[] = [];
    let nodeTypes = new Map(context.nodeTypes);
    let symbols = context.symbols;

    // Type check the object being accessed
    const objectContext: Context = {
      ...context,
      nodeTypes,
      symbols,
      pointer: context.pointer + "/object",
    };
    const objectResult = Ast.visit(context.visitor, node.object, objectContext);
    nodeTypes = objectResult.nodeTypes;
    symbols = objectResult.symbols;
    errors.push(...objectResult.errors);

    if (!objectResult.type) {
      return { symbols, nodeTypes, errors };
    }

    const objectType = objectResult.type;
    let resultType: Type | undefined;

    if (node.kind === "member") {
      const property = node.property as string;

      if (Type.isStruct(objectType)) {
        const fieldType = objectType.fields.get(property);
        if (!fieldType) {
          const error = new TypeError(
            ErrorMessages.NO_SUCH_FIELD(objectType.name, property),
            node.loc || undefined,
            undefined,
            undefined,
            ErrorCode.NO_SUCH_FIELD,
          );
          errors.push(error);
          return { symbols, nodeTypes, errors };
        }
        resultType = fieldType;
      } else if (property === "length") {
        // Handle .length property for arrays and bytes types
        if (Type.isArray(objectType)) {
          // Array length is always uint256
          resultType = Type.Elementary.uint(256);
        } else if (
          Type.isElementary(objectType) &&
          (Type.Elementary.isBytes(objectType) ||
            Type.Elementary.isString(objectType))
        ) {
          // bytes and string length is uint256
          resultType = Type.Elementary.uint(256);
        } else {
          const error = new TypeError(
            `Type ${Type.format(objectType)} does not have a length property`,
            node.loc || undefined,
            undefined,
            undefined,
            ErrorCode.INVALID_OPERATION,
          );
          errors.push(error);
          return { symbols, nodeTypes, errors };
        }
      } else {
        const error = new TypeError(
          `Cannot access member ${property} on ${Type.format(objectType)}`,
          node.loc || undefined,
          undefined,
          undefined,
          ErrorCode.INVALID_OPERATION,
        );
        errors.push(error);
        return { symbols, nodeTypes, errors };
      }
    } else if (node.kind === "slice") {
      // Slice access - start:end
      const startExpr = node.property as Ast.Expression;
      const endExpr = node.end!; // slice always has end

      const startContext: Context = {
        ...context,
        nodeTypes,
        symbols,
        pointer: context.pointer + "/property",
      };
      const startResult = Ast.visit(context.visitor, startExpr, startContext);
      nodeTypes = startResult.nodeTypes;
      symbols = startResult.symbols;
      errors.push(...startResult.errors);

      const endContext: Context = {
        ...context,
        nodeTypes,
        symbols,
        pointer: context.pointer + "/end",
      };
      const endResult = Ast.visit(context.visitor, endExpr, endContext);
      nodeTypes = endResult.nodeTypes;
      symbols = endResult.symbols;
      errors.push(...endResult.errors);

      if (!startResult.type || !endResult.type) {
        return { symbols, nodeTypes, errors };
      }

      // Only bytes types can be sliced for now
      if (
        Type.isElementary(objectType) &&
        Type.Elementary.isBytes(objectType)
      ) {
        if (
          !Type.isElementary(startResult.type) ||
          !Type.Elementary.isNumeric(startResult.type)
        ) {
          const error = new TypeError(
            "Slice start index must be numeric",
            startExpr.loc || undefined,
            undefined,
            undefined,
            ErrorCode.INVALID_INDEX_TYPE,
          );
          errors.push(error);
        }
        if (
          !Type.isElementary(endResult.type) ||
          !Type.Elementary.isNumeric(endResult.type)
        ) {
          const error = new TypeError(
            "Slice end index must be numeric",
            endExpr.loc || undefined,
            undefined,
            undefined,
            ErrorCode.INVALID_INDEX_TYPE,
          );
          errors.push(error);
        }
        // Slicing bytes returns dynamic bytes
        resultType = Type.Elementary.bytes();
      } else {
        const error = new TypeError(
          `Cannot slice ${Type.format(objectType)} - only bytes types can be sliced`,
          node.loc || undefined,
          undefined,
          undefined,
          ErrorCode.INVALID_OPERATION,
        );
        errors.push(error);
        return { symbols, nodeTypes, errors };
      }
    } else {
      // Index access
      const indexExpr = node.property as Ast.Expression;

      const indexContext: Context = {
        ...context,
        nodeTypes,
        symbols,
        pointer: context.pointer + "/property",
      };
      const indexResult = Ast.visit(context.visitor, indexExpr, indexContext);
      nodeTypes = indexResult.nodeTypes;
      symbols = indexResult.symbols;
      errors.push(...indexResult.errors);

      if (!indexResult.type) {
        return { symbols, nodeTypes, errors };
      }

      const indexType = indexResult.type;

      if (Type.isArray(objectType)) {
        if (
          !Type.isElementary(indexType) ||
          !Type.Elementary.isNumeric(indexType)
        ) {
          const error = new TypeError(
            "Array index must be numeric",
            indexExpr.loc || undefined,
            undefined,
            undefined,
            ErrorCode.INVALID_INDEX_TYPE,
          );
          errors.push(error);
        }
        resultType = objectType.element;
      } else if (Type.isMapping(objectType)) {
        if (!isAssignable(objectType.key, indexType)) {
          const error = new TypeError(
            `Invalid mapping key: expected ${Type.format(objectType.key)}, got ${Type.format(indexType)}`,
            indexExpr.loc || undefined,
            undefined,
            undefined,
            ErrorCode.TYPE_MISMATCH,
          );
          errors.push(error);
        }
        resultType = objectType.value;
      } else if (
        Type.isElementary(objectType) &&
        Type.Elementary.isBytes(objectType)
      ) {
        // Allow indexing into bytes types - returns uint8
        if (!isAssignable(Type.Elementary.uint(8), indexType)) {
          const error = new TypeError(
            `Bytes index must be a numeric type, got ${Type.format(indexType)}`,
            indexExpr.loc || undefined,
            undefined,
            undefined,
            ErrorCode.TYPE_MISMATCH,
          );
          errors.push(error);
        }
        // Bytes indexing returns uint8
        resultType = Type.Elementary.uint(8);
      } else {
        const error = new TypeError(
          ErrorMessages.CANNOT_INDEX(Type.format(objectType)),
          node.loc || undefined,
          undefined,
          undefined,
          ErrorCode.NOT_INDEXABLE,
        );
        errors.push(error);
        return { symbols, nodeTypes, errors };
      }
    }

    if (resultType) {
      nodeTypes.set(node.id, resultType);
    }

    return {
      type: resultType,
      symbols,
      nodeTypes,
      errors,
    };
  },

  callExpression(node: Ast.Expression.Call, context: Context): Report {
    const errors: TypeError[] = [];
    let nodeTypes = new Map(context.nodeTypes);
    let symbols = context.symbols;

    // Check if this is a built-in function call
    if (node.callee.type === "IdentifierExpression") {
      const functionName = node.callee.name;

      // Handle keccak256 built-in function
      if (functionName === "keccak256") {
        if (node.arguments.length !== 1) {
          const error = new TypeError(
            "keccak256 expects exactly 1 argument",
            node.loc || undefined,
            undefined,
            undefined,
            ErrorCode.INVALID_ARGUMENT_COUNT,
          );
          errors.push(error);
          return { symbols, nodeTypes, errors };
        }

        const argContext: Context = {
          ...context,
          nodeTypes,
          symbols,
          pointer: context.pointer + "/arguments/0",
        };
        const argResult = Ast.visit(
          context.visitor,
          node.arguments[0],
          argContext,
        );
        nodeTypes = argResult.nodeTypes;
        symbols = argResult.symbols;
        errors.push(...argResult.errors);

        if (!argResult.type) {
          return { symbols, nodeTypes, errors };
        }

        // keccak256 accepts bytes types and strings
        if (
          !Type.Elementary.isBytes(argResult.type) &&
          !Type.Elementary.isString(argResult.type)
        ) {
          const error = new TypeError(
            "keccak256 argument must be bytes or string type",
            node.arguments[0].loc || undefined,
            undefined,
            undefined,
            ErrorCode.TYPE_MISMATCH,
          );
          errors.push(error);
          return { symbols, nodeTypes, errors };
        }

        // keccak256 returns bytes32
        const resultType = Type.Elementary.bytes(32);
        nodeTypes.set(node.id, resultType);
        return {
          type: resultType,
          symbols,
          nodeTypes,
          errors,
        };
      }

      // Handle user-defined function calls
      const symbol = symbols.lookup(functionName);
      if (!symbol) {
        const error = new TypeError(
          ErrorMessages.UNDEFINED_VARIABLE(functionName),
          node.callee.loc || undefined,
          undefined,
          undefined,
          ErrorCode.UNDEFINED_VARIABLE,
        );
        errors.push(error);
        return { symbols, nodeTypes, errors };
      }

      if (!Type.isFunction(symbol.type)) {
        const error = new TypeError(
          `${functionName} is not a function`,
          node.callee.loc || undefined,
          undefined,
          undefined,
          ErrorCode.TYPE_MISMATCH,
        );
        errors.push(error);
        return { symbols, nodeTypes, errors };
      }

      const funcType = symbol.type;

      // Check argument count
      if (node.arguments.length !== funcType.parameters.length) {
        const error = new TypeError(
          `Function ${funcType.name} expects ${funcType.parameters.length} arguments but got ${node.arguments.length}`,
          node.loc || undefined,
          undefined,
          undefined,
          ErrorCode.INVALID_ARGUMENT_COUNT,
        );
        errors.push(error);
        return { symbols, nodeTypes, errors };
      }

      // Check argument types
      for (let i = 0; i < node.arguments.length; i++) {
        const argContext: Context = {
          ...context,
          nodeTypes,
          symbols,
          pointer: context.pointer + "/arguments/" + i,
        };
        const argResult = Ast.visit(
          context.visitor,
          node.arguments[i],
          argContext,
        );
        nodeTypes = argResult.nodeTypes;
        symbols = argResult.symbols;
        errors.push(...argResult.errors);

        if (!argResult.type) continue;

        const expectedType = funcType.parameters[i];
        if (!isAssignable(expectedType, argResult.type)) {
          const error = new TypeError(
            `Argument ${i + 1} type mismatch: expected ${Type.format(expectedType)}, got ${Type.format(argResult.type)}`,
            node.arguments[i].loc || undefined,
            Type.format(expectedType),
            Type.format(argResult.type),
            ErrorCode.TYPE_MISMATCH,
          );
          errors.push(error);
        }
      }

      // Return the function's return type
      const returnType = funcType.return || Type.failure("void function");
      nodeTypes.set(node.id, returnType);
      return {
        type: returnType,
        symbols,
        nodeTypes,
        errors,
      };
    }

    // For now, other forms of function calls are not supported
    const error = new TypeError(
      "Complex function call expressions not yet supported",
      node.loc || undefined,
      undefined,
      undefined,
      ErrorCode.INVALID_OPERATION,
    );
    errors.push(error);
    return { symbols, nodeTypes, errors };
  },

  castExpression(node: Ast.Expression.Cast, context: Context): Report {
    const errors: TypeError[] = [];
    let nodeTypes = new Map(context.nodeTypes);
    let symbols = context.symbols;

    // Get the type of the expression being cast
    const exprContext: Context = {
      ...context,
      nodeTypes,
      symbols,
      pointer: context.pointer + "/expression",
    };
    const exprResult = Ast.visit(context.visitor, node.expression, exprContext);
    nodeTypes = exprResult.nodeTypes;
    symbols = exprResult.symbols;
    errors.push(...exprResult.errors);

    if (!exprResult.type) {
      return { symbols, nodeTypes, errors };
    }

    // Resolve the target type
    const targetTypeContext: Context = {
      ...context,
      nodeTypes,
      symbols,
      pointer: context.pointer + "/targetType",
    };
    const targetTypeResult = Ast.visit(
      context.visitor,
      node.targetType,
      targetTypeContext,
    );
    nodeTypes = targetTypeResult.nodeTypes;
    symbols = targetTypeResult.symbols;
    errors.push(...targetTypeResult.errors);

    if (!targetTypeResult.type) {
      return { symbols, nodeTypes, errors };
    }

    // Check if the cast is valid
    if (!isValidCast(exprResult.type, targetTypeResult.type)) {
      const error = new TypeError(
        `Cannot cast from ${Type.format(exprResult.type)} to ${Type.format(targetTypeResult.type)}`,
        node.loc || undefined,
        Type.format(targetTypeResult.type),
        Type.format(exprResult.type),
        ErrorCode.INVALID_TYPE_CAST,
      );
      errors.push(error);
      return { symbols, nodeTypes, errors };
    }

    // Set the type of the cast expression to the target type
    nodeTypes.set(node.id, targetTypeResult.type);
    return {
      type: targetTypeResult.type,
      symbols,
      nodeTypes,
      errors,
    };
  },

  specialExpression(node: Ast.Expression.Special, context: Context): Report {
    // TODO: Handle special expressions (msg.sender, block.timestamp, etc.)
    let type: Type | undefined;

    switch (node.kind) {
      case "msg.sender":
        type = Type.Elementary.address();
        break;
      case "msg.value":
        type = Type.Elementary.uint(256);
        break;
      case "msg.data":
        type = Type.Elementary.bytes();
        break;
      case "block.timestamp":
        type = Type.Elementary.uint(256);
        break;
      case "block.number":
        type = Type.Elementary.uint(256);
        break;
    }

    const nodeTypes = new Map(context.nodeTypes);
    if (type) {
      nodeTypes.set(node.id, type);
    }

    return {
      type,
      symbols: context.symbols,
      nodeTypes,
      errors: [],
    };
  },
};

/**
 * Helper function to check if a cast is valid between two types
 */
function isValidCast(fromType: Type, toType: Type): boolean {
  // Allow casting between numeric types
  if (
    Type.isElementary(fromType) &&
    Type.isElementary(toType) &&
    Type.Elementary.isNumeric(fromType) &&
    Type.Elementary.isNumeric(toType)
  ) {
    return true;
  }

  // Allow casting from uint256 to address
  if (Type.Elementary.isUint(fromType) && Type.Elementary.isAddress(toType)) {
    return true;
  }

  // Allow casting from address to uint256
  if (Type.Elementary.isAddress(fromType) && Type.Elementary.isUint(toType)) {
    return true;
  }

  // Allow casting between bytes types
  if (Type.Elementary.isBytes(fromType) && Type.Elementary.isBytes(toType)) {
    return true;
  }

  // Allow casting from string to bytes (for slicing without UTF-8 concerns)
  if (Type.Elementary.isString(fromType) && Type.Elementary.isBytes(toType)) {
    return true;
  }

  // Allow casting from bytes to string (reverse operation)
  if (Type.Elementary.isBytes(fromType) && Type.Elementary.isString(toType)) {
    return true;
  }

  // Allow casting from bytes (including dynamic bytes) to address
  if (Type.Elementary.isBytes(fromType) && Type.Elementary.isAddress(toType)) {
    return true;
  }

  // Allow casting from bytes (including dynamic bytes) to numeric types
  if (
    Type.isElementary(fromType) &&
    Type.isElementary(toType) &&
    Type.Elementary.isBytes(fromType) &&
    Type.Elementary.isNumeric(toType)
  ) {
    return true;
  }

  // No other casts are allowed
  return false;
}
