/**
 * AST to IR transformation
 *
 * This module implements the visitor pattern to transform the normalized AST
 * into BUG-IR (intermediate representation).
 */

import * as Ast from "#ast";
import * as Ir from "#ir";
import { Type, type Types } from "#types";
import { Result, Severity, type MessagesBySeverity } from "#result";

import { Error as IrgenError, ErrorCode, ErrorMessages } from "./errors.js";

/**
 * Main IR generator - transforms AST to IR
 */
export class IrBuilder implements Ast.Visitor<void, never> {
  private context!: IrContext;
  private errors: IrgenError[] = [];

  /**
   * Build IR module from AST
   */
  build(program: Ast.Program, types: Types): Result<Ir.Module, IrgenError> {
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
      localCounter: 0,
      types,
      storage: { slots: [] },
      locals: new Map(),
      usedLocalNames: new Map(),
      loopStack: [],
    };

    // Add entry block
    this.context.currentFunction.blocks.set("entry", this.context.currentBlock);

    // Visit the program
    Ast.visit(this, program, undefined as never);

    // Ensure main function has proper terminator
    if (!this.isTerminated(this.context.currentBlock)) {
      this.setTerminator(this.context.currentBlock, { kind: "return" });
    }

    const functionsContext = this.context as IrContext & {
      functions?: Map<string, Ir.Function>;
    };

    const module: Ir.Module = {
      name: program.name,
      storage: this.context.storage,
      functions: functionsContext.functions || new Map(),
      main: this.context.currentFunction,
      loc: program.loc ?? undefined,
    };

    // Add create function if present
    const contextWithCreate = this.context as IrContext & {
      createFunction?: Ir.Function;
    };
    if (contextWithCreate.createFunction) {
      module.create = contextWithCreate.createFunction;
    }

    // Return result based on whether we have errors
    const hasErrors = this.errors.some((e) => e.severity === Severity.Error);
    if (hasErrors) {
      return Result.err(this.errors);
    }

    return Result.okWith(module, this.errors);
  }

  program(node: Ast.Program, _context: never): void {
    // Process storage declarations
    for (const decl of node.declarations) {
      if (decl.kind === "storage") {
        this.processStorageDeclaration(decl);
      }
    }

    // Process function declarations
    const functionsContext = this.context as IrContext & {
      functions?: Map<string, Ir.Function>;
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
    if ((node.create?.items || []).length > 0) {
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
      const entryBlock: Ir.Block = {
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
      if (node.create) {
        Ast.visit(this, node.create, undefined as never);
      }

      // Ensure constructor has proper terminator
      if (!this.isTerminated(this.context.currentBlock)) {
        this.setTerminator(this.context.currentBlock, { kind: "return" });
      }

      // Store create function (we'll use it when building the module)
      const contextWithCreate = this.context as IrContext & {
        createFunction?: Ir.Function;
      };
      contextWithCreate.createFunction = this.context.currentFunction;

      // Restore main function context
      this.context.currentFunction = savedFunction;
      this.context.currentBlock = savedBlock;
      this.context.locals = savedLocals;
    }

    // Process code block
    if (node.body) {
      Ast.visit(this, node.body, undefined as never);
    }
  }

  processStorageDeclaration(decl: Ast.Declaration): void {
    if (decl.kind === "storage") {
      const type = this.context.types.get(decl.id);
      if (type) {
        this.context.storage.slots.push({
          slot: decl.slot,
          name: decl.name,
          type: this.bugTypeToIrType(type),
          loc: decl.loc ?? undefined,
        });
      }
    }
  }

  processFunctionDeclaration(decl: Ast.Declaration): Ir.Function | null {
    if (decl.kind !== "function") {
      return null;
    }

    // Save current context
    const savedFunction = this.context.currentFunction;
    const savedBlock = this.context.currentBlock;
    const savedLocals = this.context.locals;

    // Create new function
    const func: Ir.Function = {
      name: decl.name,
      locals: [],
      entry: "entry",
      blocks: new Map(),
    };
    this.context.currentFunction = func;
    this.context.locals = new Map();
    this.context.usedLocalNames = new Map();

    // Create entry block
    const entryBlock: Ir.Block = {
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
    let paramCount = 0;
    const funcType = this.context.types.get(decl.id);
    if (funcType && Type.isFunction(funcType)) {
      paramCount = decl.parameters.length;
      for (let i = 0; i < paramCount; i++) {
        const param = decl.parameters[i];
        const paramType = funcType.parameterTypes[i];

        const localVar: Ir.Function.LocalVariable = {
          name: param.name,
          type: this.bugTypeToIrType(paramType),
          id: this.genLocalId(param.name),
          loc: decl.loc ?? undefined,
        };
        func.locals.push(localVar);
        this.context.locals.set(param.name, localVar);
      }
    }

    // Set parameter count if there are parameters
    if (paramCount > 0) {
      func.paramCount = paramCount;
    }

    // Process function body
    Ast.visit(this, decl.body, undefined as never);

    // Ensure function has proper terminator
    if (!this.isTerminated(this.context.currentBlock)) {
      const declType = this.context.types.get(decl.id);
      if (declType && Type.isFunction(declType) && declType.returnType) {
        // Function should return a value but doesn't - add error
        this.errors.push(
          new IrgenError(
            `Function ${decl.name} must return a value`,
            decl.loc ?? undefined,
            Severity.Error,
            ErrorCode.MISSING_RETURN,
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

  declaration(_node: Ast.Declaration, _context: never): void {
    // Declarations are handled in context (storage, struct, etc)
  }

  block(node: Ast.Block, _context: never): void {
    for (const item of node.items || []) {
      Ast.visit(this, item, undefined as never);
    }
  }

  declarationStatement(node: Ast.Statement.Declare, _context: never): void {
    const decl = node.declaration;
    if (decl.kind === "variable") {
      // This is a let statement
      if (decl.initializer) {
        const valueTemp = this.expression(decl.initializer);

        // Create local variable
        const declType = this.context.types.get(decl.id);
        if (!declType) {
          this.errors.push(
            new IrgenError(
              `Cannot determine type for variable: ${decl.name}`,
              decl.loc ?? undefined,
              Severity.Error,
              ErrorCode.UNKNOWN_TYPE,
            ),
          );
          return;
        }

        const localVar: Ir.Function.LocalVariable = {
          name: decl.name,
          type: this.bugTypeToIrType(declType),
          id: this.genLocalId(decl.name),
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

  assignmentStatement(node: Ast.Statement.Assign, _context: never): void {
    const value = this.expression(node.value);
    this.lValue(node.target, value);
  }

  controlFlowStatement(node: Ast.Statement.ControlFlow, _context: never): void {
    switch (node.kind) {
      case "if":
        this.ifStatement(node);
        break;
      case "while":
        this.whileStatement(node);
        break;
      case "for":
        this.forStatement(node);
        break;
      case "return":
        this.returnStatement(node);
        break;
      case "break":
        this.breakStatement(node);
        break;
      case "continue":
        this.continueStatement(node);
        break;
    }
  }

  expressionStatement(node: Ast.Statement.Express, _context: never): void {
    // Evaluate expression for side effects
    this.expression(node.expression);
  }

  ifStatement(node: Ast.Statement.ControlFlow): void {
    if (!node.condition || !node.body) return;

    const condition = this.expression(node.condition);

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
    Ast.visit(this, node.body, undefined as never);
    if (!this.isTerminated(this.context.currentBlock)) {
      this.setTerminator(this.context.currentBlock, {
        kind: "jump",
        target: mergeBlock.id,
      });
    }

    // Build else block if present
    if (elseBlock && node.alternate) {
      this.context.currentBlock = elseBlock;
      Ast.visit(this, node.alternate, undefined as never);
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

  whileStatement(node: Ast.Statement.ControlFlow): void {
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
    const condition = this.expression(node.condition);
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
    Ast.visit(this, node.body, undefined as never);
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

  forStatement(node: Ast.Statement.ControlFlow): void {
    if (!node.init || !node.condition || !node.update || !node.body) return;

    // Initialize
    Ast.visit(this, node.init, undefined as never);

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
    const condition = this.expression(node.condition);
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
    Ast.visit(this, node.body, undefined as never);
    if (!this.isTerminated(this.context.currentBlock)) {
      this.setTerminator(this.context.currentBlock, {
        kind: "jump",
        target: updateBlock.id,
      });
    }

    // Build update
    this.context.currentBlock = updateBlock;
    Ast.visit(this, node.update, undefined as never);
    this.setTerminator(this.context.currentBlock, {
      kind: "jump",
      target: headerBlock.id,
    });

    // Pop loop context
    this.context.loopStack.pop();

    // Continue in exit block
    this.context.currentBlock = exitBlock;
  }

  returnStatement(node: Ast.Statement.ControlFlow): void {
    const value = node.value ? this.expression(node.value) : undefined;
    this.setTerminator(this.context.currentBlock, {
      kind: "return",
      value,
      loc: node.loc ?? undefined,
    });
  }

  breakStatement(node: Ast.Statement.ControlFlow): void {
    const loop = this.context.loopStack[this.context.loopStack.length - 1];
    if (loop) {
      this.setTerminator(this.context.currentBlock, {
        kind: "jump",
        target: loop.breakTarget,
        loc: node.loc ?? undefined,
      });
    }
  }

  continueStatement(node: Ast.Statement.ControlFlow): void {
    const loop = this.context.loopStack[this.context.loopStack.length - 1];
    if (loop) {
      this.setTerminator(this.context.currentBlock, {
        kind: "jump",
        target: loop.continueTarget,
        loc: node.loc ?? undefined,
      });
    }
  }

  expression(node: Ast.Expression): Ir.Value {
    switch (node.type) {
      case "IdentifierExpression":
        return this.identifierExpression(
          node as Ast.Expression.Identifier,
          undefined as never,
        );
      case "LiteralExpression":
        return this.literalExpression(
          node as Ast.Expression.Literal,
          undefined as never,
        );
      case "OperatorExpression":
        return this.operatorExpression(
          node as Ast.Expression.Operator,
          undefined as never,
        );
      case "AccessExpression":
        return this.accessExpression(
          node as Ast.Expression.Access,
          undefined as never,
        );
      case "CallExpression":
        return this.callExpression(
          node as Ast.Expression.Call,
          undefined as never,
        );
      case "CastExpression":
        return this.castExpression(
          node as Ast.Expression.Cast,
          undefined as never,
        );
      case "SpecialExpression":
        return this.specialExpression(
          node as Ast.Expression.Special,
          undefined as never,
        );
      default: {
        // TypeScript exhaustiveness check
        const _exhaustiveCheck: never = node;
        void _exhaustiveCheck;
        this.errors.push(
          new IrgenError(
            `Unexpected expression type`,
            undefined,
            Severity.Error,
            ErrorCode.INVALID_NODE,
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

  identifierExpression(
    node: Ast.Expression.Identifier,
    _context: never,
  ): Ir.Value {
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
      return Ir.Value.temp(temp.id, local.type);
    }

    // Check if it's a storage variable
    const storageSlot = this.context.storage.slots.find((s) => s.name === name);
    if (storageSlot) {
      const temp = this.genTemp(storageSlot.type);
      this.emit({
        kind: "load_storage",
        slot: Ir.Value.constant(BigInt(storageSlot.slot), {
          kind: "uint",
          bits: 256,
        }),
        type: storageSlot.type,
        dest: temp.id,
        loc: node.loc ?? undefined,
      });
      return Ir.Value.temp(temp.id, storageSlot.type);
    }

    this.errors.push(
      new IrgenError(
        ErrorMessages.UNKNOWN_IDENTIFIER(name),
        node.loc || undefined,
        Severity.Error,
        ErrorCode.UNKNOWN_IDENTIFIER,
      ),
    );
    return {
      kind: "const",
      value: BigInt(0),
      type: { kind: "uint", bits: 256 },
    };
  }

  literalExpression(node: Ast.Expression.Literal, _context: never): Ir.Value {
    const nodeType = this.context.types.get(node.id);
    if (!nodeType) {
      this.errors.push(
        new IrgenError(
          `Cannot determine type for literal: ${node.value}`,
          node.loc ?? undefined,
          Severity.Error,
          ErrorCode.UNKNOWN_TYPE,
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
          new IrgenError(
            `Unknown literal kind: ${node.kind}`,
            node.loc || undefined,
            Severity.Error,
            ErrorCode.INVALID_NODE,
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

    return Ir.Value.temp(temp.id, type);
  }

  operatorExpression(node: Ast.Expression.Operator, _context: never): Ir.Value {
    const nodeType = this.context.types.get(node.id);
    if (!nodeType) {
      this.errors.push(
        new IrgenError(
          `Cannot determine type for operator expression: ${node.operator}`,
          node.loc ?? undefined,
          Severity.Error,
          ErrorCode.UNKNOWN_TYPE,
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
      const operand = this.expression(node.operands[0]);

      this.emit({
        kind: "unary",
        op: node.operator === "!" ? "not" : "neg",
        operand,
        dest: temp.id,
        loc: node.loc ?? undefined,
      });
    } else if (node.operands.length === 2) {
      // Binary operator
      const left = this.expression(node.operands[0]);
      const right = this.expression(node.operands[1]);

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
        new IrgenError(
          `Invalid operator arity: ${node.operands.length}`,
          node.loc || undefined,
          Severity.Error,
          ErrorCode.INVALID_NODE,
        ),
      );
      return {
        kind: "const",
        value: BigInt(0),
        type: { kind: "uint", bits: 256 },
      };
    }

    return Ir.Value.temp(temp.id, resultType);
  }

  accessExpression(node: Ast.Expression.Access, _context: never): Ir.Value {
    if (node.kind === "member") {
      const property = node.property as string;

      // Check if this is a .length property access
      if (property === "length") {
        const objectType = this.context.types.get(node.object.id);

        // Verify that the object type supports .length (arrays, bytes, string)
        if (
          objectType &&
          (Type.isArray(objectType) ||
            (Type.isElementary(objectType) &&
              (Type.Elementary.isBytes(objectType) ||
                Type.Elementary.isString(objectType))))
        ) {
          const object = this.expression(node.object);
          const resultType: Ir.Type = { kind: "uint", bits: 256 };
          const temp = this.genTemp(resultType);

          this.emit({
            kind: "length",
            object,
            dest: temp.id,
            loc: node.loc ?? undefined,
          });

          return Ir.Value.temp(temp.id, resultType);
        }
      }

      // First check if this is accessing a storage chain (e.g., accounts[user].balance)
      const chain = this.findStorageAccessChain(node);
      if (chain) {
        const nodeType = this.context.types.get(node.id);
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
      const object = this.expression(node.object);
      const objectType = this.context.types.get(node.object.id);

      if (objectType && Type.isStruct(objectType)) {
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

          return Ir.Value.temp(temp.id, irFieldType);
        }
      }
    } else if (node.kind === "slice") {
      // Slice access - start:end
      const objectType = this.context.types.get(node.object.id);
      if (
        objectType &&
        Type.isElementary(objectType) &&
        Type.Elementary.isBytes(objectType)
      ) {
        const object = this.expression(node.object);
        const start = this.expression(node.property as Ast.Expression);
        const end = this.expression(node.end!);

        // Slicing bytes returns dynamic bytes
        const resultType: Ir.Type = { kind: "bytes" };
        const temp = this.genTemp(resultType);

        this.emit({
          kind: "slice",
          object,
          start,
          end,
          dest: temp.id,
          loc: node.loc ?? undefined,
        });

        return Ir.Value.temp(temp.id, resultType);
      }

      this.errors.push(
        new IrgenError(
          "Only bytes types can be sliced",
          node.loc || undefined,
          Severity.Error,
          ErrorCode.INVALID_NODE,
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
      const objectType = this.context.types.get(node.object.id);
      if (
        objectType &&
        Type.isElementary(objectType) &&
        Type.Elementary.isBytes(objectType)
      ) {
        // Handle bytes indexing directly, not as storage chain
        const object = this.expression(node.object);
        const index = this.expression(node.property as Ast.Expression);

        // Bytes indexing returns uint8
        const elementType: Ir.Type = { kind: "uint", bits: 8 };
        const temp = this.genTemp(elementType);

        this.emit({
          kind: "load_index",
          array: object,
          index,
          elementType,
          dest: temp.id,
          loc: node.loc ?? undefined,
        });

        return Ir.Value.temp(temp.id, elementType);
      }

      // For non-bytes types, try to find a complete storage access chain
      const chain = this.findStorageAccessChain(node);
      if (chain) {
        const nodeType = this.context.types.get(node.id);
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
      const object = this.expression(node.object);
      const index = this.expression(node.property as Ast.Expression);

      if (objectType && Type.isArray(objectType)) {
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

        return Ir.Value.temp(temp.id, elementType);
      } else if (objectType && Type.isMapping(objectType)) {
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

          return Ir.Value.temp(temp.id, valueType);
        }
      }
    }

    this.errors.push(
      new IrgenError(
        "Invalid access expression",
        node.loc || undefined,
        Severity.Error,
        ErrorCode.INVALID_NODE,
      ),
    );
    return {
      kind: "const",
      value: BigInt(0),
      type: { kind: "uint", bits: 256 },
    };
  }

  castExpression(node: Ast.Expression.Cast, _context: never): Ir.Value {
    // Evaluate the expression being cast
    const exprValue = this.expression(node.expression);

    // Get the target type from the type checker
    const targetType = this.context.types.get(node.id);
    if (!targetType) {
      this.errors.push(
        new IrgenError(
          "Cannot determine target type for cast expression",
          node.loc ?? undefined,
          Severity.Error,
          ErrorCode.UNKNOWN_TYPE,
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

  callExpression(node: Ast.Expression.Call, _context: never): Ir.Value {
    // Check if this is a built-in function call
    if (
      node.callee.type === "IdentifierExpression" &&
      node.callee.name === "keccak256"
    ) {
      // keccak256 built-in function
      if (node.arguments.length !== 1) {
        this.errors.push(
          new IrgenError(
            "keccak256 expects exactly 1 argument",
            node.loc || undefined,
            Severity.Error,
            ErrorCode.INVALID_ARGUMENT_COUNT,
          ),
        );
        return {
          kind: "const",
          value: BigInt(0),
          type: { kind: "bytes", size: 32 },
        };
      }

      // Evaluate the argument
      const argValue = this.expression(node.arguments[0]);

      // Generate hash instruction
      const resultType: Ir.Type = { kind: "bytes", size: 32 }; // bytes32
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
      const callType = this.context.types.get(node.id);
      if (!callType) {
        this.errors.push(
          new IrgenError(
            `Unknown function: ${functionName}`,
            node.loc || undefined,
            Severity.Error,
            ErrorCode.UNKNOWN_TYPE,
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
        argValues.push(this.expression(arg));
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
      new IrgenError(
        "Complex function call expressions not yet supported",
        node.loc || undefined,
        Severity.Error,
        ErrorCode.UNSUPPORTED_FEATURE,
      ),
    );
    return {
      kind: "const",
      value: BigInt(0),
      type: { kind: "uint", bits: 256 },
    };
  }

  specialExpression(node: Ast.Expression.Special, _context: never): Ir.Value {
    const nodeType = this.context.types.get(node.id);
    if (!nodeType) {
      this.errors.push(
        new IrgenError(
          `Cannot determine type for special expression: ${node.kind}`,
          node.loc ?? undefined,
          Severity.Error,
          ErrorCode.UNKNOWN_TYPE,
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

    let op: Ir.Instruction.Env["op"];
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
          new IrgenError(
            `Unknown special expression: ${node.kind}`,
            node.loc || undefined,
            Severity.Error,
            ErrorCode.INVALID_NODE,
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

    return Ir.Value.temp(temp.id, resultType);
  }

  // Required visitor methods for types
  elementaryType(_node: Ast.Type.Elementary, _context: never): void {
    // Not used in IR generation
  }

  complexType(_node: Ast.Type.Complex, _context: never): void {
    // Not used in IR generation
  }

  referenceType(_node: Ast.Type.Reference, _context: never): void {
    // Not used in IR generation
  }

  /**
   * Handle assignment to an lvalue
   */
  private lValue(node: Ast.Expression, value: Ir.Value): void {
    if (node.type === "IdentifierExpression") {
      const name = (node as Ast.Expression.Identifier).name;

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
          slot: Ir.Value.constant(BigInt(storageSlot.slot), {
            kind: "uint",
            bits: 256,
          }),
          value,
          loc: node.loc ?? undefined,
        });
        return;
      }

      this.errors.push(
        new IrgenError(
          ErrorMessages.UNKNOWN_IDENTIFIER(name),
          node.loc || undefined,
          Severity.Error,
          ErrorCode.UNKNOWN_IDENTIFIER,
        ),
      );
      return;
    } else if (node.type === "AccessExpression") {
      const accessNode = node as Ast.Expression.Access;

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
          const name = (baseExpr as Ast.Expression.Identifier).name;
          const local = this.context.locals.get(name);
          if (local) {
            // This assignment won't persist to storage
            // The error was already reported in findStorageAccessChain
            return;
          }
        }

        // Otherwise, handle regular struct field assignment
        const object = this.expression(accessNode.object);
        const objectType = this.context.types.get(accessNode.object.id);

        if (objectType && Type.isStruct(objectType)) {
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
        const objectType = this.context.types.get(accessNode.object.id);
        if (
          objectType &&
          Type.isElementary(objectType) &&
          Type.Elementary.isBytes(objectType)
        ) {
          // Handle bytes indexing directly
          const object = this.expression(accessNode.object);
          const index = this.expression(accessNode.property as Ast.Expression);

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
          currentNode = (currentNode as Ast.Expression.Access).object;
        }
        if (currentNode.type === "IdentifierExpression") {
          const name = (currentNode as Ast.Expression.Identifier).name;
          const local = this.context.locals.get(name);
          if (local) {
            // This assignment won't persist to storage
            // The error was already reported in findStorageAccessChain
            return;
          }
        }

        // If no storage chain, handle regular array/mapping access
        const object = this.expression(accessNode.object);
        const index = this.expression(accessNode.property as Ast.Expression);

        if (objectType && Type.isArray(objectType)) {
          this.emit({
            kind: "store_index",
            array: object,
            index,
            value,
            loc: node.loc ?? undefined,
          });
          return;
        } else if (objectType && Type.isMapping(objectType)) {
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
      new IrgenError(
        "Invalid lvalue",
        node.loc || undefined,
        Severity.Error,
        ErrorCode.INVALID_LVALUE,
      ),
    );
  }

  // Helper methods

  private emit(instruction: Ir.Instruction): void {
    this.context.currentBlock.instructions.push(instruction);
  }

  private genTemp(type: Ir.Type): { id: string; type: Ir.Type } {
    const id = `t${this.context.tempCounter++}`;
    return { id, type };
  }

  private genLocalId(name: string): string {
    // Check if this name has been used before
    const count = this.context.usedLocalNames.get(name) || 0;
    this.context.usedLocalNames.set(name, count + 1);

    // Return the name with suffix only if needed
    return count === 0 ? name : `${name}_${count}`;
  }

  private createBlock(label: string): Ir.Block {
    const id = `${label}_${this.context.blockCounter++}`;
    const block: Ir.Block = {
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

  private setTerminator(
    block: Ir.Block,
    terminator: Ir.Block.Terminator,
  ): void {
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

  private isTerminated(block: Ir.Block): boolean {
    return (
      block.terminator !== undefined &&
      (block.terminator.kind === "return" ||
        block.terminator.kind === "jump" ||
        block.terminator.kind === "branch")
    );
  }

  private astOpToIrOp(op: string): Ir.Instruction.BinaryOp["op"] {
    switch (op) {
      case "+":
        return "add" as const;
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
          new IrgenError(
            `Unknown operator: ${op}. This is likely a bug in the compiler.`,
            undefined,
            Severity.Error,
            ErrorCode.INTERNAL_ERROR,
          ),
        );
        return "add"; // Default fallback for error case
    }
  }

  private bugTypeToIrType(type: Type): Ir.Type {
    if (Type.isArray(type)) {
      return {
        kind: "array",
        element: this.bugTypeToIrType(type.elementType),
        size: type.size,
      };
    }

    if (Type.isMapping(type)) {
      return {
        kind: "mapping",
        key: this.bugTypeToIrType(type.keyType),
        value: this.bugTypeToIrType(type.valueType),
      };
    }

    if (Type.isStruct(type)) {
      const fields: Ir.Type.StructField[] = [];
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
    }

    if (Type.isFailure(type)) {
      // Error type should already have diagnostics added elsewhere
      return { kind: "uint", bits: 256 }; // Default fallback for error case
    }

    if (Type.isFunction(type)) {
      // Function types are not directly convertible to IR types
      // This shouldn't happen in normal code generation
      this.errors.push(
        new IrgenError(
          `Cannot convert function type to IR type`,
          undefined,
          Severity.Error,
          ErrorCode.UNKNOWN_TYPE,
        ),
      );
      return { kind: "uint", bits: 256 }; // Default fallback
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
          this.errors.push(
            new IrgenError(
              `Unknown elementary type: ${type.kind}`,
              undefined,
              Severity.Error,
              ErrorCode.UNKNOWN_TYPE,
            ),
          );
          return { kind: "uint", bits: 256 }; // Default fallback for error case
      }
    }

    this.errors.push(
      new IrgenError(
        `Cannot convert type to IR: ${(type as { kind?: string }).kind || "unknown"}`,
        undefined,
        Severity.Error,
        ErrorCode.UNKNOWN_TYPE,
      ),
    );
    return { kind: "uint", bits: 256 }; // Default fallback for error case
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
      const accessNode = current as Ast.Expression.Access;

      if (accessNode.kind === "index") {
        // For index access, we need to evaluate the key expression
        const key = this.expression(accessNode.property as Ast.Expression);
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
      const name = (current as Ast.Expression.Identifier).name;
      const slot = this.context.storage.slots.find((s) => s.name === name);
      if (slot) {
        return { slot, accesses };
      }

      // Check if it's a local variable (which means we're trying to access
      // storage through an intermediate variable - not supported)
      const local = this.context.locals.get(name);
      if (local && accesses.length > 0) {
        // Get the type to provide better error message
        const localType = this.context.types.get(current.id);
        const typeDesc = localType
          ? (localType as Type & { name?: string; kind?: string }).name ||
            (localType as Type & { name?: string; kind?: string }).kind ||
            "complex"
          : "unknown";

        this.errors.push(
          new IrgenError(
            ErrorMessages.STORAGE_MODIFICATION_ERROR(name, typeDesc),
            expr.loc ?? undefined,
            Severity.Error,
            ErrorCode.STORAGE_ACCESS_ERROR,
          ),
        );
      }
    } else if (current.type === "CallExpression") {
      // Provide specific error for function calls
      this.errors.push(
        new IrgenError(
          ErrorMessages.UNSUPPORTED_STORAGE_PATTERN("function return values"),
          expr.loc || undefined,
          Severity.Error,
          ErrorCode.UNSUPPORTED_FEATURE,
        ),
      );
    } else if (accesses.length > 0) {
      // Other unsupported base expressions when we have an access chain
      this.errors.push(
        new IrgenError(
          `Storage access chain must start with a storage variable identifier. ` +
            `Found ${current.type} at the base of the access chain.`,
          current.loc ?? undefined,
          Severity.Error,
          ErrorCode.STORAGE_ACCESS_ERROR,
        ),
      );
    }

    return undefined;
  }

  private findStorageVariable(
    expr: Ast.Expression,
  ): Ir.Module.StorageSlot | undefined {
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
        slot: Ir.Value.constant(BigInt(chain.slot.slot), {
          kind: "uint",
          bits: 256,
        }),
        value,
        loc,
      });
      return;
    }

    // Compute the final storage slot through the chain
    let currentSlot: Ir.Value = Ir.Value.constant(BigInt(chain.slot.slot), {
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
            keyType: (currentType as { kind: "mapping"; key: Ir.Type }).key,
            dest: slotTemp.id,
            loc,
          });
          currentSlot = Ir.Value.temp(slotTemp.id, { kind: "uint", bits: 256 });
          currentType = (currentType as { kind: "mapping"; value: Ir.Type })
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
            left: Ir.Value.temp(baseSlotTemp.id, { kind: "uint", bits: 256 }),
            right: access.key,
            dest: finalSlotTemp.id,
            loc,
          });

          currentSlot = Ir.Value.temp(finalSlotTemp.id, {
            kind: "uint",
            bits: 256,
          });
          currentType = (currentType as { kind: "array"; element: Ir.Type })
            .element;
        } else {
          this.errors.push(
            new IrgenError(
              `Cannot index into non-mapping/array type: ${currentType.kind}`,
              loc,
              Severity.Error,
              ErrorCode.UNKNOWN_TYPE,
            ),
          );
        }
      } else if (access.kind === "member" && access.fieldName) {
        // Struct field access: add field offset
        if (currentType.kind === "struct") {
          const structType = currentType as {
            kind: "struct";
            name: string;
            fields: Ir.Type.StructField[];
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
            currentSlot = Ir.Value.temp(offsetTemp.id, {
              kind: "uint",
              bits: 256,
            });
            currentType = structType.fields[fieldIndex].type;
          } else {
            this.errors.push(
              new IrgenError(
                `Field ${access.fieldName} not found in struct ${structType.name}`,
                loc,
                Severity.Error,
                ErrorCode.UNKNOWN_TYPE,
              ),
            );
          }
        } else {
          this.errors.push(
            new IrgenError(
              `Cannot access member of non-struct type: ${currentType.kind}`,
              loc,
              Severity.Error,
              ErrorCode.UNKNOWN_TYPE,
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
    resultType: Ir.Type,
    loc?: Ast.SourceLocation,
  ): Ir.Value {
    if (chain.accesses.length === 0) {
      // Direct storage load
      const temp = this.genTemp(resultType);
      this.emit({
        kind: "load_storage",
        slot: Ir.Value.constant(BigInt(chain.slot.slot), {
          kind: "uint",
          bits: 256,
        }),
        type: resultType,
        dest: temp.id,
        loc,
      });
      return Ir.Value.temp(temp.id, resultType);
    }

    // Compute the final storage slot through the chain
    let currentSlot: Ir.Value = Ir.Value.constant(BigInt(chain.slot.slot), {
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
            keyType: (currentType as { kind: "mapping"; key: Ir.Type }).key,
            dest: slotTemp.id,
            loc,
          });
          currentSlot = Ir.Value.temp(slotTemp.id, { kind: "uint", bits: 256 });
          currentType = (currentType as { kind: "mapping"; value: Ir.Type })
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
            left: Ir.Value.temp(baseSlotTemp.id, { kind: "uint", bits: 256 }),
            right: access.key,
            dest: finalSlotTemp.id,
            loc,
          });

          currentSlot = Ir.Value.temp(finalSlotTemp.id, {
            kind: "uint",
            bits: 256,
          });
          currentType = (currentType as { kind: "array"; element: Ir.Type })
            .element;
        } else {
          this.errors.push(
            new IrgenError(
              `Cannot index into non-mapping/array type: ${currentType.kind}`,
              loc,
              Severity.Error,
              ErrorCode.UNKNOWN_TYPE,
            ),
          );
        }
      } else if (access.kind === "member" && access.fieldName) {
        // Struct field access: add field offset
        if (currentType.kind === "struct") {
          const structType = currentType as {
            kind: "struct";
            name: string;
            fields: Ir.Type.StructField[];
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
            currentSlot = Ir.Value.temp(offsetTemp.id, {
              kind: "uint",
              bits: 256,
            });
            currentType = structType.fields[fieldIndex].type;
          } else {
            this.errors.push(
              new IrgenError(
                `Field ${access.fieldName} not found in struct ${structType.name}`,
                loc,
                Severity.Error,
                ErrorCode.UNKNOWN_TYPE,
              ),
            );
          }
        } else {
          this.errors.push(
            new IrgenError(
              `Cannot access member of non-struct type: ${currentType.kind}`,
              loc,
              Severity.Error,
              ErrorCode.UNKNOWN_TYPE,
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

    return Ir.Value.temp(resultTemp.id, resultType);
  }
}

/**
 * Context for IR building - tracks current state during traversal
 */
export interface IrContext {
  /** Current function being built */
  currentFunction: Ir.Function;
  /** Current basic block being built */
  currentBlock: Ir.Block;
  /** Counter for generating unique temporary IDs */
  tempCounter: number;
  /** Counter for generating unique block IDs */
  blockCounter: number;
  /** Counter for generating unique local IDs */
  localCounter: number;
  /** Types mapping for type information */
  types: Types;
  /** Storage layout being built */
  storage: Ir.Module.StorageLayout;
  /** Mapping from AST variable names to IR local IDs */
  locals: Map<string, Ir.Function.LocalVariable>;
  /** Track used local names to handle shadowing */
  usedLocalNames: Map<string, number>;
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
  slot: Ir.Module.StorageSlot;
  accesses: Array<{
    kind: "index" | "member";
    key?: Ir.Value; // For index access
    fieldName?: string; // For member access
    fieldIndex?: number; // For member access
  }>;
}
