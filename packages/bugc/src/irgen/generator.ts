/**
 * AST to IR transformation
 *
 * This module implements the visitor pattern to transform the normalized AST
 * into BUG-IR (intermediate representation).
 */

import { BaseAstVisitor } from "../ast";
import * as Ast from "../ast";
import * as Ir from "../ir";
import {
  Type,
  ElementaryType,
  ArrayType,
  MappingType,
  StructType,
  FunctionType,
  ErrorType,
  TypeMap,
} from "../types";
import { Result, Severity, type MessagesBySeverity } from "../result";
import {
  IrError,
  IrErrorCode,
  IrErrorMessages as ErrorMessages,
} from "../ir/errors";

/**
 * Main IR generator - transforms AST to IR
 */
export class IrGenerator extends BaseAstVisitor<void> {
  private context!: IrContext;
  private errors: IrError[] = [];

  /**
   * Build IR module from AST
   */
  build(program: Ast.Program, types: TypeMap): Result<Ir.IrModule, IrError> {
    // Reset errors
    this.errors = [];
    // Initialize context
    this.context = {
      currentFunction: {
        name: "main",
        locals: [],
        entry: "entry",
        blocks: new Map(),
      },
      currentBlock: {
        id: "entry",
        phis: [],
        instructions: [],
        // @ts-expect-error - terminator will be set before module is returned
        terminator: undefined,
        predecessors: new Set(),
        loc: program.loc ?? undefined,
      },
      tempCounter: 0,
      blockCounter: 1,
      types,
      storage: { slots: [] },
      locals: new Map(),
      loopStack: [],
    };

    // Add entry block
    this.context.currentFunction.blocks.set("entry", this.context.currentBlock);

    // Visit the program
    this.visitProgram(program);

    // Ensure main function has proper terminator
    if (!this.isTerminated(this.context.currentBlock)) {
      this.setTerminator(this.context.currentBlock, { kind: "return" });
    }

    const functionsContext = this.context as IrContext & {
      functions?: Map<string, Ir.IrFunction>;
    };

    const module: Ir.IrModule = {
      name: program.name,
      storage: this.context.storage,
      functions: functionsContext.functions || new Map(),
      main: this.context.currentFunction,
      loc: program.loc ?? undefined,
    };

    // Add create function if present
    const contextWithCreate = this.context as IrContext & {
      createFunction?: Ir.IrFunction;
    };
    if (contextWithCreate.createFunction) {
      module.create = contextWithCreate.createFunction;
    }

    // Build messages by severity
    const messages: MessagesBySeverity<IrError> = {};
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
      value: module,
      messages,
    };
  }

  visitProgram(node: Ast.Program): void {
    // Process storage declarations
    for (const decl of node.declarations) {
      if (decl.kind === "storage") {
        this.processStorageDeclaration(decl);
      }
    }

    // Process function declarations
    const functionsContext = this.context as IrContext & {
      functions?: Map<string, Ir.IrFunction>;
    };
    functionsContext.functions = new Map();

    for (const decl of node.declarations) {
      if (decl.kind === "function") {
        const func = this.processFunctionDeclaration(decl);
        if (func) {
          functionsContext.functions.set(decl.name, func);
        }
      }
    }

    // Process create block (may be empty)
    if (node.create.items.length > 0) {
      // Save current function context
      const savedFunction = this.context.currentFunction;
      const savedBlock = this.context.currentBlock;
      const savedLocals = this.context.locals;

      // Create new function for constructor
      this.context.currentFunction = {
        name: "create",
        locals: [],
        entry: "entry",
        blocks: new Map(),
      };
      this.context.locals = new Map();

      // Create entry block for constructor
      const entryBlock: Ir.BasicBlock = {
        id: "entry",
        phis: [],
        instructions: [],
        // @ts-expect-error - terminator will be set later
        terminator: undefined,
        predecessors: new Set(),
      };
      this.context.currentBlock = entryBlock;
      this.context.currentFunction.blocks.set("entry", entryBlock);

      // Process create block statements
      this.visitBlock(node.create);

      // Ensure constructor has proper terminator
      if (!this.isTerminated(this.context.currentBlock)) {
        this.setTerminator(this.context.currentBlock, { kind: "return" });
      }

      // Store create function (we'll use it when building the module)
      const contextWithCreate = this.context as IrContext & {
        createFunction?: Ir.IrFunction;
      };
      contextWithCreate.createFunction = this.context.currentFunction;

      // Restore main function context
      this.context.currentFunction = savedFunction;
      this.context.currentBlock = savedBlock;
      this.context.locals = savedLocals;
    }

    // Process code block
    this.visitBlock(node.body);
  }

  processStorageDeclaration(decl: Ast.Declaration): void {
    if (decl.metadata?.slot !== undefined) {
      const type = this.context.types.get(decl);
      if (type) {
        this.context.storage.slots.push({
          slot: decl.metadata.slot,
          name: decl.name,
          type: this.bugTypeToIrType(type),
          loc: decl.loc ?? undefined,
        });
      }
    }
  }

  processFunctionDeclaration(decl: Ast.Declaration): Ir.IrFunction | null {
    if (decl.kind !== "function" || !decl.metadata?.body) {
      return null;
    }

    // Save current context
    const savedFunction = this.context.currentFunction;
    const savedBlock = this.context.currentBlock;
    const savedLocals = this.context.locals;

    // Create new function
    const func: Ir.IrFunction = {
      name: decl.name,
      locals: [],
      entry: "entry",
      blocks: new Map(),
    };
    this.context.currentFunction = func;
    this.context.locals = new Map();

    // Create entry block
    const entryBlock: Ir.BasicBlock = {
      id: "entry",
      phis: [],
      instructions: [],
      // @ts-expect-error - terminator will be set later
      terminator: undefined,
      predecessors: new Set(),
    };
    this.context.currentBlock = entryBlock;
    func.blocks.set("entry", entryBlock);

    // Process function parameters
    const funcType = this.context.types.get(decl);
    if (funcType && funcType instanceof FunctionType) {
      const ft = funcType as FunctionType;
      for (let i = 0; i < (decl.metadata.parameters || []).length; i++) {
        const param = decl.metadata.parameters![i];
        const paramType = ft.parameterTypes[i];

        const localVar: Ir.LocalVariable = {
          name: param.name,
          type: this.bugTypeToIrType(paramType),
          id: `local_${param.name}`,
          loc: decl.loc ?? undefined,
        };
        func.locals.push(localVar);
        this.context.locals.set(param.name, localVar);
      }
    }

    // Process function body
    this.visitBlock(decl.metadata.body);

    // Ensure function has proper terminator
    if (!this.isTerminated(this.context.currentBlock)) {
      const declType = this.context.types.get(decl);
      if (declType instanceof FunctionType && declType.returnType) {
        // Function should return a value but doesn't - add error
        this.errors.push(
          new IrError(
            `Function ${decl.name} must return a value`,
            decl.loc ?? undefined,
            Severity.Error,
            IrErrorCode.MISSING_RETURN,
          ),
        );
      }
      this.setTerminator(this.context.currentBlock, { kind: "return" });
    }

    // Restore context
    this.context.currentFunction = savedFunction;
    this.context.currentBlock = savedBlock;
    this.context.locals = savedLocals;

    return func;
  }

  visitDeclaration(_node: Ast.Declaration): void {
    // Declarations are handled in context (storage, struct, etc)
  }

  visitBlock(node: Ast.Block): void {
    for (const item of node.items || []) {
      this.visit(item);
    }
  }

  visitDeclarationStatement(node: Ast.DeclarationStatement): void {
    const decl = node.declaration;
    if (decl.kind === "variable") {
      // This is a let statement
      if (decl.initializer) {
        const valueTemp = this.visitExpression(decl.initializer);

        // Create local variable
        const declType = this.context.types.get(decl);
        if (!declType) {
          this.errors.push(
            new IrError(
              `Cannot determine type for variable: ${decl.name}`,
              decl.loc ?? undefined,
              Severity.Error,
              IrErrorCode.UNKNOWN_TYPE,
            ),
          );
          return;
        }

        const localVar: Ir.LocalVariable = {
          name: decl.name,
          type: this.bugTypeToIrType(declType),
          id: `local_${decl.name}`,
          loc: decl.loc ?? undefined,
        };

        this.context.currentFunction.locals.push(localVar);
        this.context.locals.set(decl.name, localVar);

        // Store initial value
        this.emit({
          kind: "store_local",
          local: localVar.id,
          localType: localVar.type,
          value: valueTemp,
          loc: node.loc ?? undefined,
        });
      }
    }
  }

  visitAssignmentStatement(node: Ast.AssignmentStatement): void {
    const value = this.visitExpression(node.value);
    this.visitLValue(node.target, value);
  }

  visitControlFlowStatement(node: Ast.ControlFlowStatement): void {
    switch (node.kind) {
      case "if":
        this.visitIfStatement(node);
        break;
      case "while":
        this.visitWhileStatement(node);
        break;
      case "for":
        this.visitForStatement(node);
        break;
      case "return":
        this.visitReturnStatement(node);
        break;
      case "break":
        this.visitBreakStatement(node);
        break;
      case "continue":
        this.visitContinueStatement(node);
        break;
    }
  }

  visitExpressionStatement(node: Ast.ExpressionStatement): void {
    // Evaluate expression for side effects
    this.visitExpression(node.expression);
  }

  visitIfStatement(node: Ast.ControlFlowStatement): void {
    if (!node.condition || !node.body) return;

    const condition = this.visitExpression(node.condition);

    const thenBlock = this.createBlock("then");
    const elseBlock = node.alternate ? this.createBlock("else") : null;
    const mergeBlock = this.createBlock("merge");

    // Add branch terminator
    this.setTerminator(this.context.currentBlock, {
      kind: "branch",
      condition,
      trueTarget: thenBlock.id,
      falseTarget: elseBlock?.id || mergeBlock.id,
      loc: node.loc ?? undefined,
    });

    // Build then block
    this.context.currentBlock = thenBlock;
    this.visitBlock(node.body);
    if (!this.isTerminated(this.context.currentBlock)) {
      this.setTerminator(this.context.currentBlock, {
        kind: "jump",
        target: mergeBlock.id,
      });
    }

    // Build else block if present
    if (elseBlock && node.alternate) {
      this.context.currentBlock = elseBlock;
      this.visitBlock(node.alternate);
      if (!this.isTerminated(this.context.currentBlock)) {
        this.setTerminator(this.context.currentBlock, {
          kind: "jump",
          target: mergeBlock.id,
        });
      }
    }

    // Continue in merge block
    this.context.currentBlock = mergeBlock;
  }

  visitWhileStatement(node: Ast.ControlFlowStatement): void {
    if (!node.condition || !node.body) return;

    const headerBlock = this.createBlock("while_header");
    const bodyBlock = this.createBlock("while_body");
    const exitBlock = this.createBlock("while_exit");

    // Jump to header
    this.setTerminator(this.context.currentBlock, {
      kind: "jump",
      target: headerBlock.id,
    });

    // Build header (condition check)
    this.context.currentBlock = headerBlock;
    const condition = this.visitExpression(node.condition);
    this.setTerminator(this.context.currentBlock, {
      kind: "branch",
      condition,
      trueTarget: bodyBlock.id,
      falseTarget: exitBlock.id,
      loc: node.loc ?? undefined,
    });

    // Push loop context
    this.context.loopStack.push({
      continueTarget: headerBlock.id,
      breakTarget: exitBlock.id,
    });

    // Build body
    this.context.currentBlock = bodyBlock;
    this.visitBlock(node.body);
    if (!this.isTerminated(this.context.currentBlock)) {
      this.setTerminator(this.context.currentBlock, {
        kind: "jump",
        target: headerBlock.id,
      });
    }

    // Pop loop context
    this.context.loopStack.pop();

    // Continue in exit block
    this.context.currentBlock = exitBlock;
  }

  visitForStatement(node: Ast.ControlFlowStatement): void {
    if (!node.init || !node.condition || !node.update || !node.body) return;

    // Initialize
    this.visit(node.init);

    // Create blocks
    const headerBlock = this.createBlock("for_header");
    const bodyBlock = this.createBlock("for_body");
    const updateBlock = this.createBlock("for_update");
    const exitBlock = this.createBlock("for_exit");

    // Jump to header
    this.setTerminator(this.context.currentBlock, {
      kind: "jump",
      target: headerBlock.id,
    });

    // Build header (condition check)
    this.context.currentBlock = headerBlock;
    const condition = this.visitExpression(node.condition);
    this.setTerminator(this.context.currentBlock, {
      kind: "branch",
      condition,
      trueTarget: bodyBlock.id,
      falseTarget: exitBlock.id,
      loc: node.loc ?? undefined,
    });

    // Push loop context
    this.context.loopStack.push({
      continueTarget: updateBlock.id,
      breakTarget: exitBlock.id,
    });

    // Build body
    this.context.currentBlock = bodyBlock;
    this.visitBlock(node.body);
    if (!this.isTerminated(this.context.currentBlock)) {
      this.setTerminator(this.context.currentBlock, {
        kind: "jump",
        target: updateBlock.id,
      });
    }

    // Build update
    this.context.currentBlock = updateBlock;
    this.visit(node.update);
    this.setTerminator(this.context.currentBlock, {
      kind: "jump",
      target: headerBlock.id,
    });

    // Pop loop context
    this.context.loopStack.pop();

    // Continue in exit block
    this.context.currentBlock = exitBlock;
  }

  visitReturnStatement(node: Ast.ControlFlowStatement): void {
    const value = node.value ? this.visitExpression(node.value) : undefined;
    this.setTerminator(this.context.currentBlock, {
      kind: "return",
      value,
      loc: node.loc ?? undefined,
    });
  }

  visitBreakStatement(node: Ast.ControlFlowStatement): void {
    const loop = this.context.loopStack[this.context.loopStack.length - 1];
    if (loop) {
      this.setTerminator(this.context.currentBlock, {
        kind: "jump",
        target: loop.breakTarget,
        loc: node.loc ?? undefined,
      });
    }
  }

  visitContinueStatement(node: Ast.ControlFlowStatement): void {
    const loop = this.context.loopStack[this.context.loopStack.length - 1];
    if (loop) {
      this.setTerminator(this.context.currentBlock, {
        kind: "jump",
        target: loop.continueTarget,
        loc: node.loc ?? undefined,
      });
    }
  }

  visitExpression(node: Ast.Expression): Ir.Value {
    switch (node.type) {
      case "IdentifierExpression":
        return this.visitIdentifierExpression(node as Ast.IdentifierExpression);
      case "LiteralExpression":
        return this.visitLiteralExpression(node as Ast.LiteralExpression);
      case "OperatorExpression":
        return this.visitOperatorExpression(node as Ast.OperatorExpression);
      case "AccessExpression":
        return this.visitAccessExpression(node as Ast.AccessExpression);
      case "CallExpression":
        return this.visitCallExpression(node as Ast.CallExpression);
      case "CastExpression":
        return this.visitCastExpression(node as Ast.CastExpression);
      case "SpecialExpression":
        return this.visitSpecialExpression(node as Ast.SpecialExpression);
      default: {
        // TypeScript exhaustiveness check
        const _exhaustiveCheck: never = node;
        void _exhaustiveCheck;
        this.errors.push(
          new IrError(
            `Unexpected expression type`,
            undefined,
            Severity.Error,
            IrErrorCode.INVALID_NODE,
          ),
        );
        return {
          kind: "const",
          value: BigInt(0),
          type: { kind: "uint", bits: 256 },
        };
      }
    }
  }

  visitIdentifierExpression(node: Ast.IdentifierExpression): Ir.Value {
    const name = node.name;

    // Check if it's a local variable
    const local = this.context.locals.get(name);
    if (local) {
      const temp = this.genTemp(local.type);
      this.emit({
        kind: "load_local",
        local: local.id,
        dest: temp.id,
        loc: node.loc ?? undefined,
      });
      return Ir.temp(temp.id, local.type);
    }

    // Check if it's a storage variable
    const storageSlot = this.context.storage.slots.find((s) => s.name === name);
    if (storageSlot) {
      const temp = this.genTemp(storageSlot.type);
      this.emit({
        kind: "load_storage",
        slot: Ir.constant(BigInt(storageSlot.slot), {
          kind: "uint",
          bits: 256,
        }),
        type: storageSlot.type,
        dest: temp.id,
        loc: node.loc ?? undefined,
      });
      return Ir.temp(temp.id, storageSlot.type);
    }

    this.errors.push(
      new IrError(
        ErrorMessages.UNKNOWN_IDENTIFIER(name),
        node.loc || undefined,
        Severity.Error,
        IrErrorCode.UNKNOWN_IDENTIFIER,
      ),
    );
    return {
      kind: "const",
      value: BigInt(0),
      type: { kind: "uint", bits: 256 },
    };
  }

  visitLiteralExpression(node: Ast.LiteralExpression): Ir.Value {
    const nodeType = this.context.types.get(node);
    if (!nodeType) {
      this.errors.push(
        new IrError(
          `Cannot determine type for literal: ${node.value}`,
          node.loc ?? undefined,
          Severity.Error,
          IrErrorCode.UNKNOWN_TYPE,
        ),
      );
      // Return a default value to allow compilation to continue
      return {
        kind: "const",
        value: BigInt(0),
        type: { kind: "uint", bits: 256 },
      };
    }

    const type = this.bugTypeToIrType(nodeType);
    const temp = this.genTemp(type);

    let value: bigint | string | boolean;
    switch (node.kind) {
      case "number":
        value = BigInt(node.value);
        break;
      case "hex": {
        // For hex literals, check if they fit in a BigInt (up to 32 bytes / 256 bits)
        // Remove 0x prefix if present for counting
        const hexValue = node.value.startsWith("0x")
          ? node.value.slice(2)
          : node.value;

        // If the hex value is longer than 64 characters (32 bytes),
        // store it as a string with 0x prefix
        if (hexValue.length > 64) {
          // Ensure it has 0x prefix for consistency
          value = node.value.startsWith("0x") ? node.value : `0x${node.value}`;
        } else {
          value = BigInt(node.value);
        }
        break;
      }
      case "address":
      case "string":
        value = node.value;
        break;
      case "boolean":
        value = node.value === "true";
        break;
      default:
        this.errors.push(
          new IrError(
            `Unknown literal kind: ${node.kind}`,
            node.loc || undefined,
            Severity.Error,
            IrErrorCode.INVALID_NODE,
          ),
        );
        return {
          kind: "const",
          value: BigInt(0),
          type: { kind: "uint", bits: 256 },
        };
    }

    this.emit({
      kind: "const",
      value,
      type,
      dest: temp.id,
      loc: node.loc ?? undefined,
    });

    return Ir.temp(temp.id, type);
  }

  visitOperatorExpression(node: Ast.OperatorExpression): Ir.Value {
    const nodeType = this.context.types.get(node);
    if (!nodeType) {
      this.errors.push(
        new IrError(
          `Cannot determine type for operator expression: ${node.operator}`,
          node.loc ?? undefined,
          Severity.Error,
          IrErrorCode.UNKNOWN_TYPE,
        ),
      );
      // Return a default value to allow compilation to continue
      return {
        kind: "const",
        value: BigInt(0),
        type: { kind: "uint", bits: 256 },
      };
    }

    const resultType = this.bugTypeToIrType(nodeType);
    const temp = this.genTemp(resultType);

    if (node.operands.length === 1) {
      // Unary operator
      const operand = this.visitExpression(node.operands[0]);

      this.emit({
        kind: "unary",
        op: node.operator === "!" ? "not" : "neg",
        operand,
        dest: temp.id,
        loc: node.loc ?? undefined,
      });
    } else if (node.operands.length === 2) {
      // Binary operator
      const left = this.visitExpression(node.operands[0]);
      const right = this.visitExpression(node.operands[1]);

      this.emit({
        kind: "binary",
        op: this.astOpToIrOp(node.operator),
        left,
        right,
        dest: temp.id,
        loc: node.loc ?? undefined,
      });
    } else {
      this.errors.push(
        new IrError(
          `Invalid operator arity: ${node.operands.length}`,
          node.loc || undefined,
          Severity.Error,
          IrErrorCode.INVALID_NODE,
        ),
      );
      return {
        kind: "const",
        value: BigInt(0),
        type: { kind: "uint", bits: 256 },
      };
    }

    return Ir.temp(temp.id, resultType);
  }

  visitAccessExpression(node: Ast.AccessExpression): Ir.Value {
    if (node.kind === "member") {
      const property = node.property as string;

      // Check if this is a .length property access
      if (property === "length") {
        const objectType = this.context.types.get(node.object);

        // Verify that the object type supports .length (arrays, bytes, string)
        if (
          objectType instanceof ArrayType ||
          (objectType instanceof ElementaryType &&
            (objectType.kind === "bytes" || objectType.kind === "string"))
        ) {
          const object = this.visitExpression(node.object);
          const resultType: Ir.TypeRef = { kind: "uint", bits: 256 };
          const temp = this.genTemp(resultType);

          this.emit({
            kind: "length",
            object,
            dest: temp.id,
            loc: node.loc ?? undefined,
          });

          return Ir.temp(temp.id, resultType);
        }
      }

      // First check if this is accessing a storage chain (e.g., accounts[user].balance)
      const chain = this.findStorageAccessChain(node);
      if (chain) {
        const nodeType = this.context.types.get(node);
        if (nodeType) {
          const valueType = this.bugTypeToIrType(nodeType);
          return this.emitStorageChainLoad(
            chain,
            valueType,
            node.loc ?? undefined,
          );
        }
      }

      // Reading through local variables is allowed, no diagnostic needed

      // Otherwise, handle regular struct field access
      const object = this.visitExpression(node.object);
      const objectType = this.context.types.get(node.object);

      if (objectType instanceof StructType) {
        const fieldType = objectType.fields.get(node.property as string);
        if (fieldType) {
          const fieldIndex = Array.from(objectType.fields.keys()).indexOf(
            node.property as string,
          );
          const irFieldType = this.bugTypeToIrType(fieldType);
          const temp = this.genTemp(irFieldType);

          this.emit({
            kind: "load_field",
            object,
            field: node.property as string,
            fieldIndex,
            type: irFieldType,
            dest: temp.id,
            loc: node.loc ?? undefined,
          });

          return Ir.temp(temp.id, irFieldType);
        }
      }
    } else if (node.kind === "slice") {
      // Slice access - start:end
      const objectType = this.context.types.get(node.object);
      if (objectType instanceof ElementaryType && objectType.kind === "bytes") {
        const object = this.visitExpression(node.object);
        const start = this.visitExpression(node.property as Ast.Expression);
        const end = this.visitExpression(node.end!);

        // Slicing bytes returns dynamic bytes
        const resultType: Ir.TypeRef = { kind: "bytes" };
        const temp = this.genTemp(resultType);

        this.emit({
          kind: "slice",
          object,
          start,
          end,
          dest: temp.id,
          loc: node.loc ?? undefined,
        });

        return Ir.temp(temp.id, resultType);
      }

      this.errors.push(
        new IrError(
          "Only bytes types can be sliced",
          node.loc || undefined,
          Severity.Error,
          IrErrorCode.INVALID_NODE,
        ),
      );
      return {
        kind: "const",
        value: BigInt(0),
        type: { kind: "uint", bits: 256 },
      };
    } else {
      // Array/mapping/bytes index access
      // First check if we're indexing into bytes (not part of storage chain)
      const objectType = this.context.types.get(node.object);
      if (objectType instanceof ElementaryType && objectType.kind === "bytes") {
        // Handle bytes indexing directly, not as storage chain
        const object = this.visitExpression(node.object);
        const index = this.visitExpression(node.property as Ast.Expression);

        // Bytes indexing returns uint8
        const elementType: Ir.TypeRef = { kind: "uint", bits: 8 };
        const temp = this.genTemp(elementType);

        this.emit({
          kind: "load_index",
          array: object,
          index,
          elementType,
          dest: temp.id,
          loc: node.loc ?? undefined,
        });

        return Ir.temp(temp.id, elementType);
      }

      // For non-bytes types, try to find a complete storage access chain
      const chain = this.findStorageAccessChain(node);
      if (chain) {
        const nodeType = this.context.types.get(node);
        if (nodeType) {
          const valueType = this.bugTypeToIrType(nodeType);
          return this.emitStorageChainLoad(
            chain,
            valueType,
            node.loc ?? undefined,
          );
        }
      }

      // If no storage chain, handle regular array/mapping access
      const object = this.visitExpression(node.object);
      const index = this.visitExpression(node.property as Ast.Expression);

      if (objectType instanceof ArrayType) {
        const elementType = this.bugTypeToIrType(objectType.elementType);
        const temp = this.genTemp(elementType);

        this.emit({
          kind: "load_index",
          array: object,
          index,
          elementType,
          dest: temp.id,
          loc: node.loc ?? undefined,
        });

        return Ir.temp(temp.id, elementType);
      } else if (objectType instanceof MappingType) {
        // Simple mapping access
        const storageVar = this.findStorageVariable(node.object);
        if (storageVar) {
          const valueType = this.bugTypeToIrType(objectType.valueType);
          const temp = this.genTemp(valueType);

          this.emit({
            kind: "load_mapping",
            slot: storageVar.slot,
            key: index,
            valueType,
            dest: temp.id,
            loc: node.loc ?? undefined,
          });

          return Ir.temp(temp.id, valueType);
        }
      }
    }

    this.errors.push(
      new IrError(
        "Invalid access expression",
        node.loc || undefined,
        Severity.Error,
        IrErrorCode.INVALID_NODE,
      ),
    );
    return {
      kind: "const",
      value: BigInt(0),
      type: { kind: "uint", bits: 256 },
    };
  }

  visitCastExpression(node: Ast.CastExpression): Ir.Value {
    // Evaluate the expression being cast
    const exprValue = this.visitExpression(node.expression);

    // Get the target type from the type checker
    const targetType = this.context.types.get(node);
    if (!targetType) {
      this.errors.push(
        new IrError(
          "Cannot determine target type for cast expression",
          node.loc ?? undefined,
          Severity.Error,
          IrErrorCode.UNKNOWN_TYPE,
        ),
      );
      return exprValue; // Return the original value
    }

    const targetIrType = this.bugTypeToIrType(targetType);

    // For now, we'll generate a cast instruction that will be handled during bytecode generation
    // In many cases, the cast is a no-op at the IR level (e.g., uint256 to address)
    const resultTemp = this.genTemp(targetIrType).id;

    this.emit({
      kind: "cast",
      value: exprValue,
      targetType: targetIrType,
      dest: resultTemp,
      loc: node.loc || undefined,
    });

    return { kind: "temp", id: resultTemp, type: targetIrType };
  }

  visitCallExpression(node: Ast.CallExpression): Ir.Value {
    // Check if this is a built-in function call
    if (
      node.callee.type === "IdentifierExpression" &&
      node.callee.name === "keccak256"
    ) {
      // keccak256 built-in function
      if (node.arguments.length !== 1) {
        this.errors.push(
          new IrError(
            "keccak256 expects exactly 1 argument",
            node.loc || undefined,
            Severity.Error,
            IrErrorCode.INVALID_ARGUMENT_COUNT,
          ),
        );
        return {
          kind: "const",
          value: BigInt(0),
          type: { kind: "bytes", size: 32 },
        };
      }

      // Evaluate the argument
      const argValue = this.visitExpression(node.arguments[0]);

      // Generate hash instruction
      const resultType: Ir.TypeRef = { kind: "bytes", size: 32 }; // bytes32
      const resultTemp = this.genTemp(resultType).id;

      this.emit({
        kind: "hash",
        value: argValue,
        dest: resultTemp,
        loc: node.loc || undefined,
      });

      return { kind: "temp", id: resultTemp, type: resultType };
    }

    // Handle user-defined function calls
    if (node.callee.type === "IdentifierExpression") {
      const functionName = node.callee.name;

      // Get the function type from the type checker
      const callType = this.context.types.get(node);
      if (!callType) {
        this.errors.push(
          new IrError(
            `Unknown function: ${functionName}`,
            node.loc || undefined,
            Severity.Error,
            IrErrorCode.UNKNOWN_TYPE,
          ),
        );
        return {
          kind: "const",
          value: BigInt(0),
          type: { kind: "uint", bits: 256 },
        };
      }

      // Evaluate arguments
      const argValues: Ir.Value[] = [];
      for (const arg of node.arguments) {
        argValues.push(this.visitExpression(arg));
      }

      // Generate call instruction
      const irType = this.bugTypeToIrType(callType);
      let dest: string | undefined;

      // Only create a destination if the function returns a value
      if (callType.toString() !== "<error: void function>") {
        const temp = this.genTemp(irType);
        dest = temp.id;
      }

      this.emit({
        kind: "call",
        function: functionName,
        arguments: argValues,
        dest,
        loc: node.loc || undefined,
      });

      // Return the result value or a dummy value for void functions
      if (dest) {
        return { kind: "temp", id: dest, type: irType };
      } else {
        // Void function - return a dummy value
        return {
          kind: "const",
          value: BigInt(0),
          type: { kind: "uint", bits: 256 },
        };
      }
    }

    // Other forms of function calls not supported
    this.errors.push(
      new IrError(
        "Complex function call expressions not yet supported",
        node.loc || undefined,
        Severity.Error,
        IrErrorCode.UNSUPPORTED_FEATURE,
      ),
    );
    return {
      kind: "const",
      value: BigInt(0),
      type: { kind: "uint", bits: 256 },
    };
  }

  visitSpecialExpression(node: Ast.SpecialExpression): Ir.Value {
    const nodeType = this.context.types.get(node);
    if (!nodeType) {
      this.errors.push(
        new IrError(
          `Cannot determine type for special expression: ${node.kind}`,
          node.loc ?? undefined,
          Severity.Error,
          IrErrorCode.UNKNOWN_TYPE,
        ),
      );
      // Return a default value to allow compilation to continue
      return {
        kind: "const",
        value: BigInt(0),
        type: { kind: "uint", bits: 256 },
      };
    }

    const resultType = this.bugTypeToIrType(nodeType);
    const temp = this.genTemp(resultType);

    let op: Ir.EnvOp;
    switch (node.kind) {
      case "msg.sender":
        op = "msg_sender";
        break;
      case "msg.value":
        op = "msg_value";
        break;
      case "msg.data":
        op = "msg_data";
        break;
      case "block.timestamp":
        op = "block_timestamp";
        break;
      case "block.number":
        op = "block_number";
        break;
      default:
        this.errors.push(
          new IrError(
            `Unknown special expression: ${node.kind}`,
            node.loc || undefined,
            Severity.Error,
            IrErrorCode.INVALID_NODE,
          ),
        );
        return {
          kind: "const",
          value: BigInt(0),
          type: { kind: "uint", bits: 256 },
        };
    }

    this.emit({
      kind: "env",
      op,
      dest: temp.id,
      loc: node.loc ?? undefined,
    });

    return Ir.temp(temp.id, resultType);
  }

  // Required visitor methods for types
  visitElementaryType(_node: Ast.ElementaryType): void {
    // Not used in IR generation
  }

  visitComplexType(_node: Ast.ComplexType): void {
    // Not used in IR generation
  }

  visitReferenceType(_node: Ast.ReferenceType): void {
    // Not used in IR generation
  }

  /**
   * Handle assignment to an lvalue
   */
  private visitLValue(node: Ast.Expression, value: Ir.Value): void {
    if (node.type === "IdentifierExpression") {
      const name = (node as Ast.IdentifierExpression).name;

      // Check if it's a local
      const local = this.context.locals.get(name);
      if (local) {
        this.emit({
          kind: "store_local",
          local: local.id,
          localType: local.type,
          value,
          loc: node.loc ?? undefined,
        });
        return;
      }

      // Check if it's storage
      const storageSlot = this.context.storage.slots.find(
        (s) => s.name === name,
      );
      if (storageSlot) {
        this.emit({
          kind: "store_storage",
          slot: Ir.constant(BigInt(storageSlot.slot), {
            kind: "uint",
            bits: 256,
          }),
          value,
          loc: node.loc ?? undefined,
        });
        return;
      }

      this.errors.push(
        new IrError(
          ErrorMessages.UNKNOWN_IDENTIFIER(name),
          node.loc || undefined,
          Severity.Error,
          IrErrorCode.UNKNOWN_IDENTIFIER,
        ),
      );
      return;
    } else if (node.type === "AccessExpression") {
      const accessNode = node as Ast.AccessExpression;

      if (accessNode.kind === "member") {
        // First check if this is a storage chain assignment (e.g., accounts[user].balance = value)
        const chain = this.findStorageAccessChain(node);
        if (chain) {
          this.emitStorageChainAssignment(chain, value, node.loc ?? undefined);
          return;
        }

        // Check if we're trying to assign through a local variable
        const baseExpr = accessNode.object;
        if (baseExpr.type === "IdentifierExpression") {
          const name = (baseExpr as Ast.IdentifierExpression).name;
          const local = this.context.locals.get(name);
          if (local) {
            // This assignment won't persist to storage
            // The error was already reported in findStorageAccessChain
            return;
          }
        }

        // Otherwise, handle regular struct field assignment
        const object = this.visitExpression(accessNode.object);
        const objectType = this.context.types.get(accessNode.object);

        if (objectType instanceof StructType) {
          const fieldName = accessNode.property as string;
          const fieldType = objectType.getFieldType(fieldName);
          if (fieldType) {
            // Find field index
            let fieldIndex = 0;
            for (const [name] of objectType.fields) {
              if (name === fieldName) break;
              fieldIndex++;
            }

            this.emit({
              kind: "store_field",
              object,
              field: fieldName,
              fieldIndex,
              value,
              loc: node.loc ?? undefined,
            });
            return;
          }
        }
      } else {
        // Array/mapping/bytes assignment
        // First check if we're assigning to bytes (not part of storage chain)
        const objectType = this.context.types.get(accessNode.object);
        if (
          objectType instanceof ElementaryType &&
          objectType.kind === "bytes"
        ) {
          // Handle bytes indexing directly
          const object = this.visitExpression(accessNode.object);
          const index = this.visitExpression(
            accessNode.property as Ast.Expression,
          );

          this.emit({
            kind: "store_index",
            array: object,
            index,
            value,
            loc: node.loc ?? undefined,
          });
          return;
        }

        // For non-bytes types, try to find a complete storage access chain
        const chain = this.findStorageAccessChain(node);
        if (chain) {
          this.emitStorageChainAssignment(chain, value, node.loc ?? undefined);
          return;
        }

        // Check if we're trying to assign through a local variable
        let currentNode = accessNode.object;
        while (currentNode.type === "AccessExpression") {
          currentNode = (currentNode as Ast.AccessExpression).object;
        }
        if (currentNode.type === "IdentifierExpression") {
          const name = (currentNode as Ast.IdentifierExpression).name;
          const local = this.context.locals.get(name);
          if (local) {
            // This assignment won't persist to storage
            // The error was already reported in findStorageAccessChain
            return;
          }
        }

        // If no storage chain, handle regular array/mapping access
        const object = this.visitExpression(accessNode.object);
        const index = this.visitExpression(
          accessNode.property as Ast.Expression,
        );

        if (objectType instanceof ArrayType) {
          this.emit({
            kind: "store_index",
            array: object,
            index,
            value,
            loc: node.loc ?? undefined,
          });
          return;
        } else if (objectType instanceof MappingType) {
          // Simple mapping assignment
          const storageVar = this.findStorageVariable(accessNode.object);
          if (storageVar) {
            this.emit({
              kind: "store_mapping",
              slot: storageVar.slot,
              key: index,
              value,
              loc: node.loc ?? undefined,
            });
            return;
          }
        }
      }
    }

    this.errors.push(
      new IrError(
        "Invalid lvalue",
        node.loc || undefined,
        Severity.Error,
        IrErrorCode.INVALID_LVALUE,
      ),
    );
  }

  // Helper methods

  private emit(instruction: Ir.IrInstruction): void {
    this.context.currentBlock.instructions.push(instruction);
  }

  private genTemp(type: Ir.TypeRef): { id: string; type: Ir.TypeRef } {
    const id = `t${this.context.tempCounter++}`;
    return { id, type };
  }

  private createBlock(label: string): Ir.BasicBlock {
    const id = `${label}_${this.context.blockCounter++}`;
    const block: Ir.BasicBlock = {
      id,
      phis: [],
      instructions: [],
      // @ts-expect-error - terminator must be set explicitly before use
      terminator: undefined,
      predecessors: new Set(),
    };
    this.context.currentFunction.blocks.set(id, block);
    return block;
  }

  private setTerminator(block: Ir.BasicBlock, terminator: Ir.Terminator): void {
    // Set the terminator
    block.terminator = terminator;

    // Update predecessor information for target blocks
    switch (terminator.kind) {
      case "jump":
        this.addPredecessor(terminator.target, block.id);
        break;
      case "branch":
        this.addPredecessor(terminator.trueTarget, block.id);
        this.addPredecessor(terminator.falseTarget, block.id);
        break;
      // return has no successors
    }
  }

  private addPredecessor(targetBlockId: string, predBlockId: string): void {
    const targetBlock = this.context.currentFunction.blocks.get(targetBlockId);
    if (targetBlock) {
      targetBlock.predecessors.add(predBlockId);
    }
  }

  private isTerminated(block: Ir.BasicBlock): boolean {
    return (
      block.terminator !== undefined &&
      (block.terminator.kind === "return" ||
        block.terminator.kind === "jump" ||
        block.terminator.kind === "branch")
    );
  }

  private astOpToIrOp(op: string): Ir.BinaryOp {
    switch (op) {
      case "+":
        return "add";
      case "-":
        return "sub";
      case "*":
        return "mul";
      case "/":
        return "div";
      case "%":
        return "mod";
      case "==":
        return "eq";
      case "!=":
        return "ne";
      case "<":
        return "lt";
      case "<=":
        return "le";
      case ">":
        return "gt";
      case ">=":
        return "ge";
      case "&&":
        return "and";
      case "||":
        return "or";
      default:
        this.errors.push(
          new IrError(
            `Unknown operator: ${op}. This is likely a bug in the compiler.`,
            undefined,
            Severity.Error,
            IrErrorCode.INTERNAL_ERROR,
          ),
        );
        return "add"; // Default fallback for error case
    }
  }

  private bugTypeToIrType(type: Type): Ir.TypeRef {
    if (type instanceof ElementaryType) {
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
          this.errors.push(
            new IrError(
              `Unknown elementary type: ${type.kind}`,
              undefined,
              Severity.Error,
              IrErrorCode.UNKNOWN_TYPE,
            ),
          );
          return { kind: "uint", bits: 256 }; // Default fallback for error case
      }
    } else if (type instanceof ArrayType) {
      return {
        kind: "array",
        element: this.bugTypeToIrType(type.elementType),
        size: type.size,
      };
    } else if (type instanceof MappingType) {
      return {
        kind: "mapping",
        key: this.bugTypeToIrType(type.keyType),
        value: this.bugTypeToIrType(type.valueType),
      };
    } else if (type instanceof StructType) {
      const fields: Ir.StructField[] = [];
      let offset = 0;
      for (const [name, fieldType] of type.fields) {
        fields.push({
          name,
          type: this.bugTypeToIrType(fieldType),
          offset,
        });
        offset += 32; // Simple layout: 32 bytes per field
      }
      return {
        kind: "struct",
        name: type.name,
        fields,
      };
    } else if (type instanceof ErrorType) {
      // Error type should already have diagnostics added elsewhere
      return { kind: "uint", bits: 256 }; // Default fallback for error case
    } else if (type instanceof FunctionType) {
      // Function types are not directly convertible to IR types
      // This shouldn't happen in normal code generation
      this.errors.push(
        new IrError(
          `Cannot convert function type to IR type`,
          undefined,
          Severity.Error,
          IrErrorCode.UNKNOWN_TYPE,
        ),
      );
      return { kind: "uint", bits: 256 }; // Default fallback
    } else {
      this.errors.push(
        new IrError(
          `Cannot convert type to IR: ${(type as { kind?: string }).kind || "unknown"}`,
          undefined,
          Severity.Error,
          IrErrorCode.UNKNOWN_TYPE,
        ),
      );
      return { kind: "uint", bits: 256 }; // Default fallback for error case
    }
  }

  /**
   * Find storage variable and extract the complete access chain
   * Handles patterns like:
   * - balances[user]
   * - allowances[sender][spender]
   * - accounts[user].balance
   * - votes[proposalId][index]
   *
   * Enhanced with better diagnostics for unsupported patterns
   */
  private findStorageAccessChain(
    expr: Ast.Expression,
  ): StorageAccessChain | undefined {
    const accesses: StorageAccessChain["accesses"] = [];
    let current = expr;

    // Walk up the access chain from right to left
    while (current.type === "AccessExpression") {
      const accessNode = current as Ast.AccessExpression;

      if (accessNode.kind === "index") {
        // For index access, we need to evaluate the key expression
        const key = this.visitExpression(accessNode.property as Ast.Expression);
        accesses.unshift({ kind: "index", key });
      } else {
        // For member access on structs
        const fieldName = accessNode.property as string;
        accesses.unshift({ kind: "member", fieldName });
      }

      current = accessNode.object;
    }

    // At the end, we should have an identifier that references storage
    if (current.type === "IdentifierExpression") {
      const name = (current as Ast.IdentifierExpression).name;
      const slot = this.context.storage.slots.find((s) => s.name === name);
      if (slot) {
        return { slot, accesses };
      }

      // Check if it's a local variable (which means we're trying to access
      // storage through an intermediate variable - not supported)
      const local = this.context.locals.get(name);
      if (local && accesses.length > 0) {
        // Get the type to provide better error message
        const localType = this.context.types.get(current);
        const typeDesc = localType
          ? (localType as Type & { name?: string; kind?: string }).name ||
            (localType as Type & { name?: string; kind?: string }).kind ||
            "complex"
          : "unknown";

        this.errors.push(
          new IrError(
            ErrorMessages.STORAGE_MODIFICATION_ERROR(name, typeDesc),
            expr.loc ?? undefined,
            Severity.Error,
            IrErrorCode.STORAGE_ACCESS_ERROR,
          ),
        );
      }
    } else if (current.type === "CallExpression") {
      // Provide specific error for function calls
      this.errors.push(
        new IrError(
          ErrorMessages.UNSUPPORTED_STORAGE_PATTERN("function return values"),
          expr.loc || undefined,
          Severity.Error,
          IrErrorCode.UNSUPPORTED_FEATURE,
        ),
      );
    } else if (accesses.length > 0) {
      // Other unsupported base expressions when we have an access chain
      this.errors.push(
        new IrError(
          `Storage access chain must start with a storage variable identifier. ` +
            `Found ${current.type} at the base of the access chain.`,
          current.loc ?? undefined,
          Severity.Error,
          IrErrorCode.STORAGE_ACCESS_ERROR,
        ),
      );
    }

    return undefined;
  }

  private findStorageVariable(
    expr: Ast.Expression,
  ): Ir.StorageSlot | undefined {
    const chain = this.findStorageAccessChain(expr);
    return chain?.slot;
  }

  /**
   * Emit IR instructions for complex storage chain assignment
   * Handles nested mappings, struct fields in mappings, etc.
   */
  private emitStorageChainAssignment(
    chain: StorageAccessChain,
    value: Ir.Value,
    loc?: Ast.SourceLocation,
  ): void {
    if (chain.accesses.length === 0) {
      // Direct storage assignment
      this.emit({
        kind: "store_storage",
        slot: Ir.constant(BigInt(chain.slot.slot), { kind: "uint", bits: 256 }),
        value,
        loc,
      });
      return;
    }

    // Compute the final storage slot through the chain
    let currentSlot: Ir.Value = Ir.constant(BigInt(chain.slot.slot), {
      kind: "uint",
      bits: 256,
    });
    let currentType = chain.slot.type;

    // Process each access in the chain to compute the final slot
    for (const access of chain.accesses) {
      if (access.kind === "index" && access.key) {
        // Mapping access: compute keccak256(key || slot)
        if (currentType.kind === "mapping") {
          const slotTemp = this.genTemp({ kind: "uint", bits: 256 });
          this.emit({
            kind: "compute_slot",
            baseSlot: currentSlot,
            key: access.key,
            keyType: (currentType as { kind: "mapping"; key: Ir.TypeRef }).key,
            dest: slotTemp.id,
            loc,
          });
          currentSlot = Ir.temp(slotTemp.id, { kind: "uint", bits: 256 });
          currentType = (currentType as { kind: "mapping"; value: Ir.TypeRef })
            .value;
        } else if (currentType.kind === "array") {
          // Array access - both fixed and dynamic arrays use keccak256(slot) + index
          // to avoid storage collisions
          const baseSlotTemp = this.genTemp({ kind: "uint", bits: 256 });
          this.emit({
            kind: "compute_array_slot",
            baseSlot: currentSlot,
            dest: baseSlotTemp.id,
            loc,
          });

          // Add the index to get the final slot
          const finalSlotTemp = this.genTemp({ kind: "uint", bits: 256 });
          this.emit({
            kind: "binary",
            op: "add",
            left: Ir.temp(baseSlotTemp.id, { kind: "uint", bits: 256 }),
            right: access.key,
            dest: finalSlotTemp.id,
            loc,
          });

          currentSlot = Ir.temp(finalSlotTemp.id, { kind: "uint", bits: 256 });
          currentType = (currentType as { kind: "array"; element: Ir.TypeRef })
            .element;
        } else {
          this.errors.push(
            new IrError(
              `Cannot index into non-mapping/array type: ${currentType.kind}`,
              loc,
              Severity.Error,
              IrErrorCode.UNKNOWN_TYPE,
            ),
          );
        }
      } else if (access.kind === "member" && access.fieldName) {
        // Struct field access: add field offset
        if (currentType.kind === "struct") {
          const structType = currentType as {
            kind: "struct";
            name: string;
            fields: Ir.StructField[];
          };
          const fieldIndex = structType.fields.findIndex(
            (f) => f.name === access.fieldName,
          );

          if (fieldIndex >= 0) {
            const offsetTemp = this.genTemp({ kind: "uint", bits: 256 });
            this.emit({
              kind: "compute_field_offset",
              baseSlot: currentSlot,
              fieldIndex,
              dest: offsetTemp.id,
              loc,
            });
            currentSlot = Ir.temp(offsetTemp.id, { kind: "uint", bits: 256 });
            currentType = structType.fields[fieldIndex].type;
          } else {
            this.errors.push(
              new IrError(
                `Field ${access.fieldName} not found in struct ${structType.name}`,
                loc,
                Severity.Error,
                IrErrorCode.UNKNOWN_TYPE,
              ),
            );
          }
        } else {
          this.errors.push(
            new IrError(
              `Cannot access member of non-struct type: ${currentType.kind}`,
              loc,
              Severity.Error,
              IrErrorCode.UNKNOWN_TYPE,
            ),
          );
        }
      }
    }

    // Store to the computed slot
    this.emit({
      kind: "store_storage",
      slot: currentSlot,
      value,
      loc,
    });
  }

  /**
   * Emit IR instructions for complex storage chain reads
   * Handles nested mappings, struct fields in mappings, etc.
   */
  private emitStorageChainLoad(
    chain: StorageAccessChain,
    resultType: Ir.TypeRef,
    loc?: Ast.SourceLocation,
  ): Ir.Value {
    if (chain.accesses.length === 0) {
      // Direct storage load
      const temp = this.genTemp(resultType);
      this.emit({
        kind: "load_storage",
        slot: Ir.constant(BigInt(chain.slot.slot), { kind: "uint", bits: 256 }),
        type: resultType,
        dest: temp.id,
        loc,
      });
      return Ir.temp(temp.id, resultType);
    }

    // Compute the final storage slot through the chain
    let currentSlot: Ir.Value = Ir.constant(BigInt(chain.slot.slot), {
      kind: "uint",
      bits: 256,
    });
    let currentType = chain.slot.type;

    // Process each access in the chain to compute the final slot
    for (const access of chain.accesses) {
      if (access.kind === "index" && access.key) {
        // Mapping access: compute keccak256(key || slot)
        if (currentType.kind === "mapping") {
          const slotTemp = this.genTemp({ kind: "uint", bits: 256 });
          this.emit({
            kind: "compute_slot",
            baseSlot: currentSlot,
            key: access.key,
            keyType: (currentType as { kind: "mapping"; key: Ir.TypeRef }).key,
            dest: slotTemp.id,
            loc,
          });
          currentSlot = Ir.temp(slotTemp.id, { kind: "uint", bits: 256 });
          currentType = (currentType as { kind: "mapping"; value: Ir.TypeRef })
            .value;
        } else if (currentType.kind === "array") {
          // Array access - both fixed and dynamic arrays use keccak256(slot) + index
          // to avoid storage collisions
          const baseSlotTemp = this.genTemp({ kind: "uint", bits: 256 });
          this.emit({
            kind: "compute_array_slot",
            baseSlot: currentSlot,
            dest: baseSlotTemp.id,
            loc,
          });

          // Add the index to get the final slot
          const finalSlotTemp = this.genTemp({ kind: "uint", bits: 256 });
          this.emit({
            kind: "binary",
            op: "add",
            left: Ir.temp(baseSlotTemp.id, { kind: "uint", bits: 256 }),
            right: access.key,
            dest: finalSlotTemp.id,
            loc,
          });

          currentSlot = Ir.temp(finalSlotTemp.id, { kind: "uint", bits: 256 });
          currentType = (currentType as { kind: "array"; element: Ir.TypeRef })
            .element;
        } else {
          this.errors.push(
            new IrError(
              `Cannot index into non-mapping/array type: ${currentType.kind}`,
              loc,
              Severity.Error,
              IrErrorCode.UNKNOWN_TYPE,
            ),
          );
        }
      } else if (access.kind === "member" && access.fieldName) {
        // Struct field access: add field offset
        if (currentType.kind === "struct") {
          const structType = currentType as {
            kind: "struct";
            name: string;
            fields: Ir.StructField[];
          };
          const fieldIndex = structType.fields.findIndex(
            (f) => f.name === access.fieldName,
          );

          if (fieldIndex >= 0) {
            const offsetTemp = this.genTemp({ kind: "uint", bits: 256 });
            this.emit({
              kind: "compute_field_offset",
              baseSlot: currentSlot,
              fieldIndex,
              dest: offsetTemp.id,
              loc,
            });
            currentSlot = Ir.temp(offsetTemp.id, { kind: "uint", bits: 256 });
            currentType = structType.fields[fieldIndex].type;
          } else {
            this.errors.push(
              new IrError(
                `Field ${access.fieldName} not found in struct ${structType.name}`,
                loc,
                Severity.Error,
                IrErrorCode.UNKNOWN_TYPE,
              ),
            );
          }
        } else {
          this.errors.push(
            new IrError(
              `Cannot access member of non-struct type: ${currentType.kind}`,
              loc,
              Severity.Error,
              IrErrorCode.UNKNOWN_TYPE,
            ),
          );
        }
      }
    }

    // Load from the computed slot
    const resultTemp = this.genTemp(resultType);
    this.emit({
      kind: "load_storage",
      slot: currentSlot,
      type: resultType,
      dest: resultTemp.id,
      loc,
    });

    return Ir.temp(resultTemp.id, resultType);
  }
}

/**
 * Context for IR building - tracks current state during traversal
 */
export interface IrContext {
  /** Current function being built */
  currentFunction: Ir.IrFunction;
  /** Current basic block being built */
  currentBlock: Ir.BasicBlock;
  /** Counter for generating unique temporary IDs */
  tempCounter: number;
  /** Counter for generating unique block IDs */
  blockCounter: number;
  /** Types mapping for type information */
  types: TypeMap;
  /** Storage layout being built */
  storage: Ir.StorageLayout;
  /** Mapping from AST variable names to IR local IDs */
  locals: Map<string, Ir.LocalVariable>;
  /** Stack of loop contexts for break/continue */
  loopStack: LoopContext[];
}

interface LoopContext {
  /** Block to jump to for 'continue' */
  continueTarget: string;
  /** Block to jump to for 'break' */
  breakTarget: string;
}

/**
 * Represents a chain of accesses from a storage variable
 */
interface StorageAccessChain {
  slot: Ir.StorageSlot;
  accesses: Array<{
    kind: "index" | "member";
    key?: Ir.Value; // For index access
    fieldName?: string; // For member access
    fieldIndex?: number; // For member access
  }>;
}

