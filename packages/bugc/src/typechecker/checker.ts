/**
 * Type checker for the BUG language using normalized AST
 *
 * Validates types and builds symbol table using visitor pattern
 */

import {
  BaseAstVisitor,
  Program,
  Declaration,
  Block,
  ElementaryType,
  ComplexType,
  ReferenceType,
  DeclarationStatement,
  AssignmentStatement,
  ControlFlowStatement,
  ExpressionStatement,
  IdentifierExpression,
  LiteralExpression,
  OperatorExpression,
  AccessExpression,
  CallExpression,
  CastExpression,
  SpecialExpression,
  TypeNode,
  Expression,
  isAssignable,
  SourceLocation,
} from "../ast";

import {
  Type,
  ElementaryType as TypeElementaryType,
  ArrayType as TypeArrayType,
  MappingType as TypeMappingType,
  StructType as TypeStructType,
  FunctionType as TypeFunctionType,
  ErrorType as TypeErrorType,
  Types as TypesUtil,
  SymbolTable,
  BugSymbol,
} from "../types";
import type { TypeMap } from "../types";
import { Result, type MessagesBySeverity, Severity } from "../result";
import {
  TypeError,
  TypeErrorCode,
  TypeErrorMessages as ErrorMessages,
} from "./errors";

export class TypeChecker extends BaseAstVisitor<Type | null> {
  private symbolTable = new SymbolTable();
  private structTypes = new Map<string, TypeStructType>();
  private currentReturnType: Type | null = null;
  private nodeTypes = new WeakMap<object, Type>();
  private errors: TypeError[] = [];

  /**
   * Type check a program
   */
  check(
    program: Program,
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
    const sourceLocation = location as SourceLocation | undefined;
    this.errors.push(
      new TypeError(message, sourceLocation, expectedType, actualType, code),
    );
  }

  visitProgram(node: Program): Type | null {
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
          ?.type as TypeFunctionType;
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

  visitDeclaration(node: Declaration): Type | null {
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
          : new TypeErrorType("missing type");
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
          const errorType = new TypeErrorType("missing initializer");
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
          if (initType && !this.isAssignable(type, initType)) {
            this.error(
              ErrorMessages.TYPE_MISMATCH(
                this.typeToString(type),
                this.typeToString(initType),
              ),
              node.initializer.loc,
              TypeErrorCode.TYPE_MISMATCH,
              this.typeToString(type),
              this.typeToString(initType),
            );
          }
        } else {
          // Otherwise, infer the type from the initializer
          type = initType || new TypeErrorType("invalid initializer");
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

  visitBlock(node: Block): Type | null {
    if (node.kind === "program" || node.kind === "statements") {
      this.symbolTable.enterScope();
      for (const item of node.items) {
        this.visit(item);
      }
      this.symbolTable.exitScope();
    }
    return null;
  }

  visitElementaryType(node: ElementaryType): Type | null {
    return this.resolveType(node);
  }

  visitComplexType(node: ComplexType): Type | null {
    return this.resolveType(node);
  }

  visitReferenceType(node: ReferenceType): Type | null {
    return this.resolveType(node);
  }

  visitDeclarationStatement(node: DeclarationStatement): Type | null {
    return this.visit(node.declaration);
  }

  visitAssignmentStatement(node: AssignmentStatement): Type | null {
    if (!isAssignable(node.target)) {
      this.error(
        "Invalid assignment target",
        node.target.loc,
        TypeErrorCode.INVALID_ASSIGNMENT,
      );
      return null;
    }

    const targetType = this.visit(node.target);
    const valueType = this.visit(node.value);

    if (targetType && valueType && !this.isAssignable(targetType, valueType)) {
      this.error(
        ErrorMessages.TYPE_MISMATCH(
          this.typeToString(targetType),
          this.typeToString(valueType),
        ),
        node.loc,
        TypeErrorCode.TYPE_MISMATCH,
        this.typeToString(targetType),
        this.typeToString(valueType),
      );
    }

    return null;
  }

  visitControlFlowStatement(node: ControlFlowStatement): Type | null {
    switch (node.kind) {
      case "if": {
        if (node.condition) {
          const condType = this.visit(node.condition);
          if (condType && !this.isBoolean(condType)) {
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
          if (condType && !this.isBoolean(condType)) {
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
            if (!this.isAssignable(this.currentReturnType, valueType)) {
              this.error(
                ErrorMessages.TYPE_MISMATCH(
                  this.typeToString(this.currentReturnType),
                  this.typeToString(valueType),
                ),
                node.loc,
                TypeErrorCode.TYPE_MISMATCH,
                this.typeToString(this.currentReturnType),
                this.typeToString(valueType),
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
            `Function must return a value of type ${this.typeToString(this.currentReturnType)}`,
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

  visitExpressionStatement(node: ExpressionStatement): Type | null {
    this.visit(node.expression);
    return null;
  }

  visitIdentifierExpression(node: IdentifierExpression): Type | null {
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

  visitLiteralExpression(node: LiteralExpression): Type | null {
    let type: Type | null = null;
    switch (node.kind) {
      case "number":
        type = TypesUtil.uint256;
        break;
      case "boolean":
        type = TypesUtil.bool;
        break;
      case "string":
        type = TypesUtil.string;
        break;
      case "address":
        type = TypesUtil.address;
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
          type = new TypeElementaryType("bytes", byteCount * 8);
        } else {
          // For larger hex literals, use dynamic bytes
          type = TypesUtil.bytes;
        }
        break;
      }
    }
    if (type) {
      this.setType(node, type);
    }
    return type;
  }

  visitOperatorExpression(node: OperatorExpression): Type | null {
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
          if (!this.isBoolean(operandType)) {
            this.error(
              ErrorMessages.INVALID_UNARY_OP("!", "boolean"),
              node.loc,
              TypeErrorCode.INVALID_OPERAND,
            );
          }
          resultType = TypesUtil.bool;
          break;

        case "-":
          if (!this.isNumeric(operandType)) {
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
          if (!this.isNumeric(leftType) || !this.isNumeric(rightType)) {
            this.error(
              ErrorMessages.INVALID_BINARY_OP(node.operator, "numeric"),
              node.loc,
              TypeErrorCode.INVALID_OPERAND,
            );
          }
          resultType = this.commonNumericType(leftType, rightType);
          break;

        case "<":
        case ">":
        case "<=":
        case ">=":
          if (!this.isNumeric(leftType) || !this.isNumeric(rightType)) {
            this.error(
              ErrorMessages.INVALID_BINARY_OP(node.operator, "numeric"),
              node.loc,
              TypeErrorCode.INVALID_OPERAND,
            );
          }
          resultType = TypesUtil.bool;
          break;

        case "==":
        case "!=":
          if (!this.isComparable(leftType, rightType)) {
            this.error(
              `Cannot compare ${this.typeToString(leftType)} with ${this.typeToString(rightType)}`,
              node.loc,
              TypeErrorCode.INVALID_OPERATION,
            );
          }
          resultType = TypesUtil.bool;
          break;

        case "&&":
        case "||":
          if (!this.isBoolean(leftType) || !this.isBoolean(rightType)) {
            this.error(
              ErrorMessages.INVALID_BINARY_OP(node.operator, "boolean"),
              node.loc,
              TypeErrorCode.INVALID_OPERAND,
            );
          }
          resultType = TypesUtil.bool;
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

  visitAccessExpression(node: AccessExpression): Type | null {
    const objectType = this.visit(node.object);
    if (!objectType) return null;

    let resultType: Type | null = null;

    if (node.kind === "member") {
      const property = node.property as string;

      if (objectType instanceof TypeStructType) {
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
        if (objectType instanceof TypeArrayType) {
          // Array length is always uint256
          resultType = TypesUtil.uint256;
        } else if (
          objectType instanceof TypeElementaryType &&
          (objectType.kind === "bytes" || objectType.kind === "string")
        ) {
          // bytes and string length is uint256
          resultType = TypesUtil.uint256;
        } else {
          this.error(
            `Type ${this.typeToString(objectType)} does not have a length property`,
            node.loc,
            TypeErrorCode.INVALID_OPERATION,
          );
          return null;
        }
      } else {
        this.error(
          `Cannot access member ${property} on ${this.typeToString(objectType)}`,
          node.loc,
          TypeErrorCode.INVALID_OPERATION,
        );
        return null;
      }
    } else if (node.kind === "slice") {
      // Slice access - start:end
      const startExpr = node.property as Expression;
      const endExpr = node.end!; // slice always has end
      const startType = this.visit(startExpr);
      const endType = this.visit(endExpr);
      if (!startType || !endType) return null;

      // Only bytes types can be sliced for now
      if (
        objectType instanceof TypeElementaryType &&
        objectType.kind === "bytes"
      ) {
        if (!this.isNumeric(startType)) {
          this.error(
            "Slice start index must be numeric",
            startExpr.loc,
            TypeErrorCode.INVALID_INDEX_TYPE,
          );
        }
        if (!this.isNumeric(endType)) {
          this.error(
            "Slice end index must be numeric",
            endExpr.loc,
            TypeErrorCode.INVALID_INDEX_TYPE,
          );
        }
        // Slicing bytes returns dynamic bytes
        resultType = new TypeElementaryType("bytes");
      } else {
        this.error(
          `Cannot slice ${this.typeToString(objectType)} - only bytes types can be sliced`,
          node.loc,
          TypeErrorCode.INVALID_OPERATION,
        );
        return null;
      }
    } else {
      // Index access
      const indexExpr = node.property as Expression;
      const indexType = this.visit(indexExpr);
      if (!indexType) return null;

      if (objectType instanceof TypeArrayType) {
        if (!this.isNumeric(indexType)) {
          this.error(
            "Array index must be numeric",
            indexExpr.loc,
            TypeErrorCode.INVALID_INDEX_TYPE,
          );
        }
        resultType = objectType.elementType;
      } else if (objectType instanceof TypeMappingType) {
        if (!this.isAssignable(objectType.keyType, indexType)) {
          this.error(
            `Invalid mapping key: expected ${this.typeToString(objectType.keyType)}, got ${this.typeToString(indexType)}`,
            indexExpr.loc,
            TypeErrorCode.TYPE_MISMATCH,
          );
        }
        resultType = objectType.valueType;
      } else if (
        objectType instanceof TypeElementaryType &&
        objectType.kind === "bytes"
      ) {
        // Allow indexing into bytes types - returns uint8
        if (
          !this.isAssignable(new TypeElementaryType("uint", 256), indexType)
        ) {
          this.error(
            `Bytes index must be a numeric type, got ${this.typeToString(indexType)}`,
            indexExpr.loc,
            TypeErrorCode.TYPE_MISMATCH,
          );
        }
        // Bytes indexing returns uint8
        resultType = new TypeElementaryType("uint", 8);
      } else {
        this.error(
          ErrorMessages.CANNOT_INDEX(this.typeToString(objectType)),
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

  visitCallExpression(node: CallExpression): Type | null {
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
          !TypesUtil.isBytesType(argType) &&
          !TypesUtil.isStringType(argType)
        ) {
          this.error(
            "keccak256 argument must be bytes or string type",
            node.arguments[0].loc,
            TypeErrorCode.TYPE_MISMATCH,
          );
          return null;
        }

        // keccak256 returns bytes32
        const resultType = TypesUtil.bytes32;
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

      if (!(symbol.type instanceof TypeFunctionType)) {
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
        if (!this.isAssignable(expectedType, argType)) {
          this.error(
            `Argument ${i + 1} type mismatch: expected ${TypesUtil.toString(expectedType)}, got ${TypesUtil.toString(argType)}`,
            node.arguments[i].loc,
            TypeErrorCode.TYPE_MISMATCH,
            TypesUtil.toString(expectedType),
            TypesUtil.toString(argType),
          );
        }
      }

      // Return the function's return type
      const returnType =
        funcType.returnType || new TypeErrorType("void function");
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

  visitCastExpression(node: CastExpression): Type | null {
    // Get the type of the expression being cast
    const exprType = this.visit(node.expression);
    if (!exprType) return null;

    // Resolve the target type
    const targetType = this.resolveType(node.targetType);
    if (!targetType) return null;

    // Check if the cast is valid
    if (!this.isValidCast(exprType, targetType)) {
      this.error(
        `Cannot cast from ${TypesUtil.toString(exprType)} to ${TypesUtil.toString(targetType)}`,
        node.loc,
        TypeErrorCode.INVALID_TYPE_CAST,
        TypesUtil.toString(targetType),
        TypesUtil.toString(exprType),
      );
      return null;
    }

    // Set the type of the cast expression to the target type
    this.setType(node, targetType);
    return targetType;
  }

  private isValidCast(fromType: Type, toType: Type): boolean {
    // Allow casting between numeric types
    if (TypesUtil.isNumericType(fromType) && TypesUtil.isNumericType(toType)) {
      return true;
    }

    // Allow casting from uint256 to address
    if (TypesUtil.isUintType(fromType) && TypesUtil.isAddressType(toType)) {
      return true;
    }

    // Allow casting from address to uint256
    if (TypesUtil.isAddressType(fromType) && TypesUtil.isUintType(toType)) {
      return true;
    }

    // Allow casting between bytes types
    if (TypesUtil.isBytesType(fromType) && TypesUtil.isBytesType(toType)) {
      return true;
    }

    // Allow casting from bytes (including dynamic bytes) to address
    if (
      (TypesUtil.isBytesType(fromType) ||
        TypesUtil.isDynamicBytesType(fromType)) &&
      TypesUtil.isAddressType(toType)
    ) {
      return true;
    }

    // Allow casting from bytes (including dynamic bytes) to numeric types
    if (
      (TypesUtil.isBytesType(fromType) ||
        TypesUtil.isDynamicBytesType(fromType)) &&
      TypesUtil.isNumericType(toType)
    ) {
      return true;
    }

    // No other casts are allowed
    return false;
  }

  visitSpecialExpression(node: SpecialExpression): Type | null {
    let type: Type | null = null;
    switch (node.kind) {
      case "msg.sender":
        type = TypesUtil.address;
        break;
      case "msg.value":
        type = TypesUtil.uint256;
        break;
      case "msg.data":
        type = TypesUtil.bytes;
        break;
      case "block.timestamp":
        type = TypesUtil.uint256;
        break;
      case "block.number":
        type = TypesUtil.uint256;
        break;
    }
    if (type) {
      this.setType(node, type);
    }
    return type;
  }

  // Helper methods

  private collectStructType(decl: Declaration): void {
    if (decl.kind !== "struct") return;

    const fields = new Map<string, Type>();

    for (const field of decl.metadata?.fields || []) {
      if (field.declaredType) {
        const fieldType = this.resolveType(field.declaredType);
        fields.set(field.name, fieldType);
      }
    }

    const structType = new TypeStructType(decl.name, fields);
    this.structTypes.set(decl.name, structType);
  }

  private collectFunctionType(decl: Declaration): void {
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
    const functionType = new TypeFunctionType(
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

  private resolveType(typeNode: TypeNode): Type {
    switch (typeNode.type) {
      case "ElementaryType": {
        // Map elementary types based on kind and bits
        if (typeNode.kind === "uint") {
          const typeMap: Record<number, Type> = {
            256: TypesUtil.uint256,
            128: TypesUtil.uint128,
            64: TypesUtil.uint64,
            32: TypesUtil.uint32,
            16: TypesUtil.uint16,
            8: TypesUtil.uint8,
          };
          return (
            typeMap[typeNode.bits || 256] ||
            new TypeErrorType(`Unknown uint size: ${typeNode.bits}`)
          );
        } else if (typeNode.kind === "int") {
          // TODO: Add proper signed integer types
          const typeMap: Record<number, Type> = {
            256: TypesUtil.int256,
            128: TypesUtil.int128,
            64: TypesUtil.int64,
            32: TypesUtil.int32,
            16: TypesUtil.int16,
            8: TypesUtil.int8,
          };
          return (
            typeMap[typeNode.bits || 256] ||
            new TypeErrorType(`Unknown int size: ${typeNode.bits}`)
          );
        } else if (typeNode.kind === "bytes") {
          if (!typeNode.bits) {
            return TypesUtil.bytes; // Dynamic bytes
          }
          const typeMap: Record<number, Type> = {
            256: TypesUtil.bytes32,
            128: TypesUtil.bytes16,
            64: TypesUtil.bytes8,
            32: TypesUtil.bytes4,
          };
          return (
            typeMap[typeNode.bits] ||
            new TypeErrorType(`Unknown bytes size: ${typeNode.bits}`)
          );
        } else if (typeNode.kind === "address") {
          return TypesUtil.address;
        } else if (typeNode.kind === "bool") {
          return TypesUtil.bool;
        } else if (typeNode.kind === "string") {
          return TypesUtil.string;
        }
        return new TypeErrorType(`Unknown elementary type: ${typeNode.kind}`);
      }

      case "ComplexType":
        if (typeNode.kind === "array") {
          const elementType = this.resolveType(typeNode.typeArgs![0]);
          return new TypeArrayType(elementType, typeNode.size);
        } else if (typeNode.kind === "mapping") {
          const keyType = this.resolveType(typeNode.typeArgs![0]);
          const valueType = this.resolveType(typeNode.typeArgs![1]);
          return new TypeMappingType(keyType, valueType);
        } else {
          return new TypeErrorType(
            `Unsupported complex type: ${typeNode.kind}`,
          );
        }

      case "ReferenceType": {
        const structType = this.structTypes.get(typeNode.name);
        if (!structType) {
          this.error(
            ErrorMessages.UNDEFINED_TYPE(typeNode.name),
            typeNode.loc,
            TypeErrorCode.UNDEFINED_TYPE,
          );
          return new TypeErrorType(`Undefined struct: ${typeNode.name}`);
        }
        return structType;
      }

      default:
        return new TypeErrorType("Unknown type");
    }
  }

  private isNumeric(type: Type): boolean {
    return TypesUtil.isUintType(type);
  }

  private isBoolean(type: Type): boolean {
    return type instanceof TypeElementaryType && type.kind === "bool";
  }

  private isComparable(left: Type, right: Type): boolean {
    if (left instanceof TypeErrorType || right instanceof TypeErrorType)
      return true;
    if (left.equals(right)) return true;

    // Allow comparison between compatible types
    if (TypesUtil.areCompatible(left, right)) return true;

    return false;
  }

  private isAssignable(target: Type, value: Type): boolean {
    if (target instanceof TypeErrorType || value instanceof TypeErrorType)
      return true;
    if (target.equals(value)) return true;

    // Allow compatible assignments
    if (TypesUtil.areCompatible(target, value)) return true;

    return false;
  }

  private commonNumericType(left: Type, right: Type): Type | null {
    return TypesUtil.commonType(left, right);
  }

  private typeToString(type: Type): string {
    return type.toString();
  }
}

// Factory function for convenience
export function createTypeChecker(): TypeChecker {
  return new TypeChecker();
}
