/**
 * Type checker for the BUG language using normalized AST
 *
 * Validates types and builds symbol table using visitor pattern
 */

import * as Ast from "#ast";

import { Type, SymbolTable, type BugSymbol, type TypeMap } from "#types";

import { Result, type MessagesBySeverity, Severity } from "#result";

import {
  TypeError,
  TypeErrorCode,
  TypeErrorMessages as ErrorMessages,
} from "./errors.js";

export class TypeChecker extends Ast.BaseVisitor<Type | null> {
  private symbolTable = new SymbolTable();
  private structTypes = new Map<string, Type.Struct>();
  private currentReturnType: Type | null = null;
  private nodeTypes = new WeakMap<object, Type>();
  private errors: TypeError[] = [];

  /**
   * Type check a program
   */
  check(
    program: Ast.Program,
  ): Result<{ symbolTable: SymbolTable; types: TypeMap }, TypeError> {
    // Reset state for new check
    this.errors = [];
    this.symbolTable = new SymbolTable();
    this.structTypes.clear();
    this.nodeTypes = new WeakMap<object, Type>();

    this.visit(program);

    // Build messages by severity
    const messages: MessagesBySeverity<TypeError> = {};
    for (const error of this.errors) {
      const severity = error.severity;
      if (!messages[severity]) {
        messages[severity] = [];
      }
      messages[severity]!.push(error);
    }

    // Return result based on whether we have errors
    const hasErrors = this.errors.some((e) => e.severity === Severity.Error);
    if (hasErrors) {
      return { success: false, messages };
    }

    return {
      success: true,
      value: {
        symbolTable: this.symbolTable,
        types: this.nodeTypes,
      },
      messages,
    };
  }

  getType(node: object): Type | undefined {
    return this.nodeTypes.get(node);
  }

  private setType(node: object, type: Type): void {
    this.nodeTypes.set(node, type);
  }

  private error(
    message: string,
    location?: unknown,
    code: TypeErrorCode = TypeErrorCode.GENERAL,
    expectedType?: string,
    actualType?: string,
  ): void {
    const sourceLocation = location as Ast.SourceLocation | undefined;
    this.errors.push(
      new TypeError(message, sourceLocation, expectedType, actualType, code),
    );
  }

  visitProgram(node: Ast.Program): Type | null {
    // First pass: collect struct and function declarations
    for (const decl of node.declarations) {
      if (decl.kind === "struct") {
        this.collectStructType(decl);
      } else if (decl.kind === "function") {
        this.collectFunctionType(decl);
      }
    }

    // Second pass: process storage declarations
    for (const decl of node.declarations) {
      if (decl.kind === "storage") {
        this.visit(decl);
      }
    }

    // Third pass: type check function bodies
    for (const decl of node.declarations) {
      if (decl.kind === "function" && decl.metadata?.body) {
        // Set current return type for the function
        const funcType = this.symbolTable.lookup(decl.name)
          ?.type as Type.Function;
        if (funcType) {
          this.currentReturnType = funcType.returnType;

          // Create a new scope for function parameters
          this.symbolTable.enterScope();

          // Add parameters to the function scope
          for (let i = 0; i < (decl.metadata.parameters || []).length; i++) {
            const param = decl.metadata.parameters![i];
            const symbol: BugSymbol = {
              name: param.name,
              type: funcType.parameterTypes[i],
              mutable: true,
              location: "memory",
            };
            this.symbolTable.define(symbol);
          }

          // Type check the function body
          this.visit(decl.metadata.body);

          // Exit function scope
          this.symbolTable.exitScope();
          this.currentReturnType = null;
        }
      }
    }

    // Process create block if present
    if (node.create) {
      this.visit(node.create);
    }

    // Process code block
    this.visit(node.body);

    return null;
  }

  visitDeclaration(node: Ast.Declaration): Type | null {
    switch (node.kind) {
      case "struct":
        // Already processed in first pass
        return null;

      case "function":
        // Already processed in first pass
        return null;

      case "storage": {
        const type = node.declaredType
          ? this.resolveType(node.declaredType)
          : new Type.Failure("missing type");
        const symbol: BugSymbol = {
          name: node.name,
          type,
          mutable: true,
          location: "storage",
          slot: node.metadata?.slot,
        };
        this.symbolTable.define(symbol);
        this.setType(node, type);
        return type;
      }

      case "variable": {
        if (!node.initializer) {
          this.error(
            `Variable ${node.name} must have an initializer`,
            node.loc,
            TypeErrorCode.MISSING_INITIALIZER,
          );
          // Still define the variable with error type
          const errorType = new Type.Failure("missing initializer");
          const symbol: BugSymbol = {
            name: node.name,
            type: errorType,
            mutable: true,
            location: "memory",
          };
          this.symbolTable.define(symbol);
          this.setType(node, errorType);
          return errorType;
        }

        const initType = this.visit(node.initializer);

        // Determine the variable's type
        let type: Type;
        if (node.declaredType) {
          // If a type is explicitly declared, use it
          type = this.resolveType(node.declaredType);

          // Check that the initializer is compatible with the declared type
          if (initType && !isAssignable(type, initType)) {
            this.error(
              ErrorMessages.TYPE_MISMATCH(type.toString(), initType.toString()),
              node.initializer.loc,
              TypeErrorCode.TYPE_MISMATCH,
              type.toString(),
              initType.toString(),
            );
          }
        } else {
          // Otherwise, infer the type from the initializer
          type = initType || new Type.Failure("invalid initializer");
        }

        const symbol: BugSymbol = {
          name: node.name,
          type,
          mutable: true,
          location: "memory",
        };
        this.symbolTable.define(symbol);
        this.setType(node, type);
        return type;
      }

      case "field":
        // Fields are handled as part of struct processing
        return null;

      default:
        return null;
    }
  }

  visitBlock(node: Ast.Block): Type | null {
    if (node.kind === "program" || node.kind === "statements") {
      this.symbolTable.enterScope();
      for (const item of node.items) {
        this.visit(item);
      }
      this.symbolTable.exitScope();
    }
    return null;
  }

  visitElementaryType(node: Ast.Type.Elementary): Type | null {
    return this.resolveType(node);
  }

  visitComplexType(node: Ast.Type.Complex): Type | null {
    return this.resolveType(node);
  }

  visitReferenceType(node: Ast.Type.Reference): Type | null {
    return this.resolveType(node);
  }

  visitDeclarationStatement(node: Ast.Statement.Declare): Type | null {
    return this.visit(node.declaration);
  }

  visitAssignmentStatement(node: Ast.Statement.Assign): Type | null {
    if (!Ast.Expression.isAssignable(node.target)) {
      this.error(
        "Invalid assignment target",
        node.target.loc,
        TypeErrorCode.INVALID_ASSIGNMENT,
      );
      return null;
    }

    const targetType = this.visit(node.target);
    const valueType = this.visit(node.value);

    if (targetType && valueType && !isAssignable(targetType, valueType)) {
      this.error(
        ErrorMessages.TYPE_MISMATCH(
          targetType.toString(),
          valueType.toString(),
        ),
        node.loc,
        TypeErrorCode.TYPE_MISMATCH,
        targetType.toString(),
        valueType.toString(),
      );
    }

    return null;
  }

  visitControlFlowStatement(node: Ast.Statement.ControlFlow): Type | null {
    switch (node.kind) {
      case "if": {
        if (node.condition) {
          const condType = this.visit(node.condition);
          if (condType && !Type.Elementary.isBool(condType)) {
            this.error(
              "If condition must be boolean",
              node.condition.loc,
              TypeErrorCode.INVALID_CONDITION,
            );
          }
        }
        if (node.body) this.visit(node.body);
        if (node.alternate) this.visit(node.alternate);
        return null;
      }

      case "for": {
        this.symbolTable.enterScope();
        if (node.init) this.visit(node.init);
        if (node.condition) {
          const condType = this.visit(node.condition);
          if (condType && !Type.Elementary.isBool(condType)) {
            this.error(
              "For condition must be boolean",
              node.condition.loc,
              TypeErrorCode.INVALID_CONDITION,
            );
          }
        }
        if (node.update) this.visit(node.update);
        if (node.body) this.visit(node.body);
        this.symbolTable.exitScope();
        return null;
      }

      case "return": {
        if (node.value) {
          const valueType = this.visit(node.value);
          if (valueType && this.currentReturnType) {
            if (!isAssignable(this.currentReturnType, valueType)) {
              this.error(
                ErrorMessages.TYPE_MISMATCH(
                  this.currentReturnType.toString(),
                  valueType.toString(),
                ),
                node.loc,
                TypeErrorCode.TYPE_MISMATCH,
                this.currentReturnType.toString(),
                valueType.toString(),
              );
            }
          } else if (valueType && !this.currentReturnType) {
            this.error(
              "Cannot return a value from a void function",
              node.loc,
              TypeErrorCode.TYPE_MISMATCH,
            );
          }
        } else if (this.currentReturnType) {
          this.error(
            `Function must return a value of type ${this.currentReturnType.toString()}`,
            node.loc,
            TypeErrorCode.TYPE_MISMATCH,
          );
        }
        return null;
      }

      case "break":
        return null;

      default:
        return null;
    }
  }

  visitExpressionStatement(node: Ast.Statement.Express): Type | null {
    this.visit(node.expression);
    return null;
  }

  visitIdentifierExpression(node: Ast.Expression.Identifier): Type | null {
    const symbol = this.symbolTable.lookup(node.name);
    if (!symbol) {
      this.error(
        ErrorMessages.UNDEFINED_VARIABLE(node.name),
        node.loc,
        TypeErrorCode.UNDEFINED_VARIABLE,
      );
      return null;
    }
    this.setType(node, symbol.type);
    return symbol.type;
  }

  visitLiteralExpression(node: Ast.Expression.Literal): Type | null {
    let type: Type | null = null;
    switch (node.kind) {
      case "number":
        type = Type.Elementary.uint256;
        break;
      case "boolean":
        type = Type.Elementary.bool;
        break;
      case "string":
        type = Type.Elementary.string;
        break;
      case "address":
        type = Type.Elementary.address;
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
          type = new Type.Elementary("bytes", byteCount * 8);
        } else {
          // For larger hex literals, use dynamic bytes
          type = Type.Elementary.bytes;
        }
        break;
      }
    }
    if (type) {
      this.setType(node, type);
    }
    return type;
  }

  visitOperatorExpression(node: Ast.Expression.Operator): Type | null {
    const operandTypes = node.operands
      .map((op) => this.visit(op))
      .filter((t): t is Type => t !== null);

    if (operandTypes.length !== node.operands.length) {
      // Some operands had errors
      return null;
    }

    let resultType: Type | null = null;

    if (node.operands.length === 1) {
      // Unary operator
      const operandType = operandTypes[0];

      switch (node.operator) {
        case "!":
          if (!Type.Elementary.isBool(operandType)) {
            this.error(
              ErrorMessages.INVALID_UNARY_OP("!", "boolean"),
              node.loc,
              TypeErrorCode.INVALID_OPERAND,
            );
          }
          resultType = Type.Elementary.bool;
          break;

        case "-":
          if (!Type.Elementary.isNumeric(operandType)) {
            this.error(
              ErrorMessages.INVALID_UNARY_OP("-", "numeric"),
              node.loc,
              TypeErrorCode.INVALID_OPERAND,
            );
          }
          resultType = operandType;
          break;

        default:
          this.error(
            `Unknown unary operator: ${node.operator}`,
            node.loc,
            TypeErrorCode.INVALID_OPERATION,
          );
          return null;
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
            !Type.Elementary.isNumeric(leftType) ||
            !Type.Elementary.isNumeric(rightType)
          ) {
            this.error(
              ErrorMessages.INVALID_BINARY_OP(node.operator, "numeric"),
              node.loc,
              TypeErrorCode.INVALID_OPERAND,
            );
          }
          resultType = commonType(leftType, rightType);
          break;

        case "<":
        case ">":
        case "<=":
        case ">=":
          if (
            !Type.Elementary.isNumeric(leftType) ||
            !Type.Elementary.isNumeric(rightType)
          ) {
            this.error(
              ErrorMessages.INVALID_BINARY_OP(node.operator, "numeric"),
              node.loc,
              TypeErrorCode.INVALID_OPERAND,
            );
          }
          resultType = Type.Elementary.bool;
          break;

        case "==":
        case "!=":
          if (!isAssignable(leftType, rightType)) {
            this.error(
              `Cannot compare ${leftType.toString()} with ${rightType.toString()}`,
              node.loc,
              TypeErrorCode.INVALID_OPERATION,
            );
          }
          resultType = Type.Elementary.bool;
          break;

        case "&&":
        case "||":
          if (
            !Type.Elementary.isBool(leftType) ||
            !Type.Elementary.isBool(rightType)
          ) {
            this.error(
              ErrorMessages.INVALID_BINARY_OP(node.operator, "boolean"),
              node.loc,
              TypeErrorCode.INVALID_OPERAND,
            );
          }
          resultType = Type.Elementary.bool;
          break;

        default:
          this.error(
            `Unknown binary operator: ${node.operator}`,
            node.loc,
            TypeErrorCode.INVALID_OPERATION,
          );
          return null;
      }
    } else {
      this.error(
        `Invalid operator arity: ${node.operands.length}`,
        node.loc,
        TypeErrorCode.INVALID_OPERATION,
      );
      return null;
    }

    if (resultType) {
      this.setType(node, resultType);
    }
    return resultType;
  }

  visitAccessExpression(node: Ast.Expression.Access): Type | null {
    const objectType = this.visit(node.object);
    if (!objectType) return null;

    let resultType: Type | null = null;

    if (node.kind === "member") {
      const property = node.property as string;

      if (objectType instanceof Type.Struct) {
        const fieldType = objectType.getFieldType(property);
        if (!fieldType) {
          this.error(
            ErrorMessages.NO_SUCH_FIELD(objectType.name, property),
            node.loc,
            TypeErrorCode.NO_SUCH_FIELD,
          );
          return null;
        }
        resultType = fieldType;
      } else if (property === "length") {
        // Handle .length property for arrays and bytes types
        if (objectType instanceof Type.Array) {
          // Array length is always uint256
          resultType = Type.Elementary.uint256;
        } else if (
          Type.isElementary(objectType) &&
          (Type.Elementary.isBytes(objectType) ||
            Type.Elementary.isString(objectType))
        ) {
          // bytes and string length is uint256
          resultType = Type.Elementary.uint256;
        } else {
          this.error(
            `Type ${objectType.toString()} does not have a length property`,
            node.loc,
            TypeErrorCode.INVALID_OPERATION,
          );
          return null;
        }
      } else {
        this.error(
          `Cannot access member ${property} on ${objectType.toString()}`,
          node.loc,
          TypeErrorCode.INVALID_OPERATION,
        );
        return null;
      }
    } else if (node.kind === "slice") {
      // Slice access - start:end
      const startExpr = node.property as Ast.Expression;
      const endExpr = node.end!; // slice always has end
      const startType = this.visit(startExpr);
      const endType = this.visit(endExpr);
      if (!startType || !endType) return null;

      // Only bytes types can be sliced for now
      if (
        Type.isElementary(objectType) &&
        Type.Elementary.isBytes(objectType)
      ) {
        if (!Type.Elementary.isNumeric(startType)) {
          this.error(
            "Slice start index must be numeric",
            startExpr.loc,
            TypeErrorCode.INVALID_INDEX_TYPE,
          );
        }
        if (!Type.Elementary.isNumeric(endType)) {
          this.error(
            "Slice end index must be numeric",
            endExpr.loc,
            TypeErrorCode.INVALID_INDEX_TYPE,
          );
        }
        // Slicing bytes returns dynamic bytes
        resultType = Type.Elementary.bytes;
      } else {
        this.error(
          `Cannot slice ${objectType.toString()} - only bytes types can be sliced`,
          node.loc,
          TypeErrorCode.INVALID_OPERATION,
        );
        return null;
      }
    } else {
      // Index access
      const indexExpr = node.property as Ast.Expression;
      const indexType = this.visit(indexExpr);
      if (!indexType) return null;

      if (objectType instanceof Type.Array) {
        if (!Type.Elementary.isNumeric(indexType)) {
          this.error(
            "Array index must be numeric",
            indexExpr.loc,
            TypeErrorCode.INVALID_INDEX_TYPE,
          );
        }
        resultType = objectType.elementType;
      } else if (objectType instanceof Type.Mapping) {
        if (!isAssignable(objectType.keyType, indexType)) {
          this.error(
            `Invalid mapping key: expected ${objectType.keyType.toString()}, got ${indexType.toString()}`,
            indexExpr.loc,
            TypeErrorCode.TYPE_MISMATCH,
          );
        }
        resultType = objectType.valueType;
      } else if (
        Type.isElementary(objectType) &&
        Type.Elementary.isBytes(objectType)
      ) {
        // Allow indexing into bytes types - returns uint8
        if (!isAssignable(Type.Elementary.uint256, indexType)) {
          this.error(
            `Bytes index must be a numeric type, got ${indexType.toString()}`,
            indexExpr.loc,
            TypeErrorCode.TYPE_MISMATCH,
          );
        }
        // Bytes indexing returns uint8
        resultType = Type.Elementary.uint8;
      } else {
        this.error(
          ErrorMessages.CANNOT_INDEX(objectType.toString()),
          node.loc,
          TypeErrorCode.NOT_INDEXABLE,
        );
        return null;
      }
    }

    if (resultType) {
      this.setType(node, resultType);
    }
    return resultType;
  }

  visitCallExpression(node: Ast.Expression.Call): Type | null {
    // Check if this is a built-in function call
    if (node.callee.type === "IdentifierExpression") {
      const functionName = node.callee.name;

      // Handle keccak256 built-in function
      if (functionName === "keccak256") {
        if (node.arguments.length !== 1) {
          this.error(
            "keccak256 expects exactly 1 argument",
            node.loc,
            TypeErrorCode.INVALID_ARGUMENT_COUNT,
          );
          return null;
        }

        const argType = this.visit(node.arguments[0]);
        if (!argType) return null;

        // keccak256 accepts bytes types and strings
        if (
          !Type.Elementary.isBytes(argType) &&
          !Type.Elementary.isString(argType)
        ) {
          this.error(
            "keccak256 argument must be bytes or string type",
            node.arguments[0].loc,
            TypeErrorCode.TYPE_MISMATCH,
          );
          return null;
        }

        // keccak256 returns bytes32
        const resultType = Type.Elementary.bytes32;
        this.setType(node, resultType);
        return resultType;
      }

      // Handle user-defined function calls
      const symbol = this.symbolTable.lookup(functionName);
      if (!symbol) {
        this.error(
          ErrorMessages.UNDEFINED_VARIABLE(functionName),
          node.callee.loc,
          TypeErrorCode.UNDEFINED_VARIABLE,
        );
        return null;
      }

      if (!(symbol.type instanceof Type.Function)) {
        this.error(
          `${functionName} is not a function`,
          node.callee.loc,
          TypeErrorCode.TYPE_MISMATCH,
        );
        return null;
      }

      const funcType = symbol.type;

      // Check argument count
      if (node.arguments.length !== funcType.parameterTypes.length) {
        this.error(
          `Function ${funcType.name} expects ${funcType.parameterTypes.length} arguments but got ${node.arguments.length}`,
          node.loc,
          TypeErrorCode.INVALID_ARGUMENT_COUNT,
        );
        return null;
      }

      // Check argument types
      for (let i = 0; i < node.arguments.length; i++) {
        const argType = this.visit(node.arguments[i]);
        if (!argType) continue;

        const expectedType = funcType.parameterTypes[i];
        if (!isAssignable(expectedType, argType)) {
          this.error(
            `Argument ${i + 1} type mismatch: expected ${expectedType.toString()}, got ${argType.toString()}`,
            node.arguments[i].loc,
            TypeErrorCode.TYPE_MISMATCH,
            expectedType.toString(),
            argType.toString(),
          );
        }
      }

      // Return the function's return type
      const returnType =
        funcType.returnType || new Type.Failure("void function");
      this.setType(node, returnType);
      return returnType;
    }

    // For now, other forms of function calls are not supported
    this.error(
      "Complex function call expressions not yet supported",
      node.loc,
      TypeErrorCode.INVALID_OPERATION,
    );
    return null;
  }

  visitCastExpression(node: Ast.Expression.Cast): Type | null {
    // Get the type of the expression being cast
    const exprType = this.visit(node.expression);
    if (!exprType) return null;

    // Resolve the target type
    const targetType = this.resolveType(node.targetType);
    if (!targetType) return null;

    // Check if the cast is valid
    if (!this.isValidCast(exprType, targetType)) {
      this.error(
        `Cannot cast from ${exprType.toString()} to ${targetType.toString()}`,
        node.loc,
        TypeErrorCode.INVALID_TYPE_CAST,
        targetType.toString(),
        exprType.toString(),
      );
      return null;
    }

    // Set the type of the cast expression to the target type
    this.setType(node, targetType);
    return targetType;
  }

  private isValidCast(fromType: Type, toType: Type): boolean {
    // Allow casting between numeric types
    if (
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
    if (
      Type.Elementary.isBytes(fromType) &&
      Type.Elementary.isAddress(toType)
    ) {
      return true;
    }

    // Allow casting from bytes (including dynamic bytes) to numeric types
    if (
      Type.Elementary.isBytes(fromType) &&
      Type.Elementary.isNumeric(toType)
    ) {
      return true;
    }

    // No other casts are allowed
    return false;
  }

  visitSpecialExpression(node: Ast.Expression.Special): Type | null {
    let type: Type | null = null;
    switch (node.kind) {
      case "msg.sender":
        type = Type.Elementary.address;
        break;
      case "msg.value":
        type = Type.Elementary.uint256;
        break;
      case "msg.data":
        type = Type.Elementary.bytes;
        break;
      case "block.timestamp":
        type = Type.Elementary.uint256;
        break;
      case "block.number":
        type = Type.Elementary.uint256;
        break;
    }
    if (type) {
      this.setType(node, type);
    }
    return type;
  }

  // Helper methods

  private collectStructType(decl: Ast.Declaration): void {
    if (decl.kind !== "struct") return;

    const fields = new Map<string, Type>();

    for (const field of decl.metadata?.fields || []) {
      if (field.declaredType) {
        const fieldType = this.resolveType(field.declaredType);
        fields.set(field.name, fieldType);
      }
    }

    const structType = new Type.Struct(decl.name, fields);
    this.structTypes.set(decl.name, structType);
  }

  private collectFunctionType(decl: Ast.Declaration): void {
    if (decl.kind !== "function") return;

    // Resolve parameter types
    const parameterTypes: Type[] = [];
    for (const param of decl.metadata?.parameters || []) {
      const paramType = this.resolveType(param.type);
      parameterTypes.push(paramType);
    }

    // Resolve return type (null for void functions)
    const returnType = decl.declaredType
      ? this.resolveType(decl.declaredType)
      : null;

    // Create function type
    const functionType = new Type.Function(
      decl.name,
      parameterTypes,
      returnType,
    );

    // Store the function type on the declaration node
    this.setType(decl, functionType);

    // Add function symbol to global scope
    const symbol: BugSymbol = {
      name: decl.name,
      type: functionType,
      mutable: false,
      location: "memory",
    };
    this.symbolTable.define(symbol);
  }

  private resolveType(typeNode: Ast.Type): Type {
    switch (typeNode.type) {
      case "ElementaryType": {
        // Map elementary types based on kind and bits
        if (typeNode.kind === "uint") {
          const typeMap: Record<number, Type> = {
            256: Type.Elementary.uint256,
            128: Type.Elementary.uint128,
            64: Type.Elementary.uint64,
            32: Type.Elementary.uint32,
            16: Type.Elementary.uint16,
            8: Type.Elementary.uint8,
          };
          return (
            typeMap[typeNode.bits || 256] ||
            new Type.Failure(`Unknown uint size: ${typeNode.bits}`)
          );
        } else if (typeNode.kind === "int") {
          // TODO: Add proper signed integer types
          const typeMap: Record<number, Type> = {
            256: Type.Elementary.int256,
            128: Type.Elementary.int128,
            64: Type.Elementary.int64,
            32: Type.Elementary.int32,
            16: Type.Elementary.int16,
            8: Type.Elementary.int8,
          };
          return (
            typeMap[typeNode.bits || 256] ||
            new Type.Failure(`Unknown int size: ${typeNode.bits}`)
          );
        } else if (typeNode.kind === "bytes") {
          if (!typeNode.bits) {
            return Type.Elementary.bytes; // Dynamic bytes
          }
          const typeMap: Record<number, Type> = {
            256: Type.Elementary.bytes32,
            128: Type.Elementary.bytes16,
            64: Type.Elementary.bytes8,
            32: Type.Elementary.bytes4,
          };
          return (
            typeMap[typeNode.bits] ||
            new Type.Failure(`Unknown bytes size: ${typeNode.bits}`)
          );
        } else if (typeNode.kind === "address") {
          return Type.Elementary.address;
        } else if (typeNode.kind === "bool") {
          return Type.Elementary.bool;
        } else if (typeNode.kind === "string") {
          return Type.Elementary.string;
        }
        return new Type.Failure(`Unknown elementary type: ${typeNode.kind}`);
      }

      case "ComplexType":
        if (typeNode.kind === "array") {
          const elementType = this.resolveType(typeNode.typeArgs![0]);
          return new Type.Array(elementType, typeNode.size);
        } else if (typeNode.kind === "mapping") {
          const keyType = this.resolveType(typeNode.typeArgs![0]);
          const valueType = this.resolveType(typeNode.typeArgs![1]);
          return new Type.Mapping(keyType, valueType);
        } else {
          return new Type.Failure(`Unsupported complex type: ${typeNode.kind}`);
        }

      case "ReferenceType": {
        const structType = this.structTypes.get(typeNode.name);
        if (!structType) {
          this.error(
            ErrorMessages.UNDEFINED_TYPE(typeNode.name),
            typeNode.loc,
            TypeErrorCode.UNDEFINED_TYPE,
          );
          return new Type.Failure(`Undefined struct: ${typeNode.name}`);
        }
        return structType;
      }

      default:
        return new Type.Failure("Unknown type");
    }
  }
}

function isAssignable(target: Type, value: Type): boolean {
  if (Type.isFailure(target) || Type.isFailure(value)) {
    return true;
  }
  if (target.equals(value)) {
    return true;
  }

  // Numeric types can be implicitly converted (with range checks)
  if (Type.Elementary.isNumeric(target) && Type.Elementary.isNumeric(value)) {
    // Only allow same signedness
    if (Type.Elementary.isUint(target) && Type.Elementary.isUint(value)) {
      return true;
    }
    if (Type.Elementary.isInt(target) && Type.Elementary.isInt(value)) {
      return true;
    }
  }

  return false;
}

function commonType(type1: Type, type2: Type): Type | null {
  if (type1.equals(type2)) {
    return type1;
  }

  // For numeric types, return the larger type
  if (Type.isElementary(type1) && Type.isElementary(type2)) {
    if (Type.Elementary.isUint(type1) && Type.Elementary.isUint(type2)) {
      const size1 = type1.bits || 256;
      const size2 = type2.bits || 256;
      return size1 >= size2 ? type1 : type2;
    }
    if (Type.Elementary.isInt(type1) && Type.Elementary.isInt(type2)) {
      const size1 = type1.bits || 256;
      const size2 = type2.bits || 256;
      return size1 >= size2 ? type1 : type2;
    }
  }

  return null;
}

// Factory function for convenience
export function createTypeChecker(): TypeChecker {
  return new TypeChecker();
}
