import type * as Ast from "#ast";
import * as Ir from "#ir";
import type { IrState, Transition } from "./state.js";
import { Error as IrgenError, ErrorMessages } from "./errors.js";
import { Severity } from "#result";
import { pipe, type IrBuilder } from "./builder.js";
import { operations } from "./operations.js";
import { addError } from "./updates.js";
import { Type } from "#types";
import { type IrGen, gen, lift, runGen } from "./irgen.js";

/**
 * Build an expression and return the resulting IR value
 */
export function buildExpression(expr: Ast.Expression): Transition<Ir.Value> {
  switch (expr.type) {
    case "IdentifierExpression":
      return buildIdentifier(expr as Ast.Expression.Identifier);
    case "LiteralExpression":
      return buildLiteral(expr as Ast.Expression.Literal);
    case "OperatorExpression":
      return buildOperator(expr as Ast.Expression.Operator);
    case "AccessExpression":
      return buildAccess(expr as Ast.Expression.Access);
    case "CallExpression":
      return buildCall(expr as Ast.Expression.Call);
    case "CastExpression":
      return buildCast(expr as Ast.Expression.Cast);
    case "SpecialExpression":
      return buildSpecial(expr as Ast.Expression.Special);
    default:
      return (state) => ({
        state: addError(
          state,
          new IrgenError(
            // @ts-expect-error switch statement is exhaustive; expr is never
            `Unsupported expression type: ${expr.type}`,
            // @ts-expect-error switch statement is exhaustive; expr is never
            expr.loc ?? undefined,
            Severity.Error,
          ),
        ),
        value: Ir.Value.constant(0n, { kind: "uint", bits: 256 }),
      });
  }
}

/**
 * Build an identifier expression
 */
function buildIdentifier(
  expr: Ast.Expression.Identifier,
): Transition<Ir.Value> {
  return runGen(
    (function* () {
      const local = yield* gen.lookupVariable(expr.name);

      if (local) {
        // Load the local variable
        const tempId = yield* gen.genTemp();

        yield* gen.emit({
          kind: "load_local",
          local: local.id,
          dest: tempId,
          loc: expr.loc ?? undefined,
        } as Ir.Instruction.LoadLocal);

        return Ir.Value.temp(tempId, local.type);
      }

      // Check if it's a storage variable
      const state = yield* gen.peek();
      const storageSlot = state.module.storage.slots.find(
        ({ name }) => name === expr.name,
      );

      if (storageSlot) {
        return yield* lift(buildStorageLoad(storageSlot, expr));
      }

      // Unknown identifier - add error and return default value
      yield* gen.addError(
        new IrgenError(
          ErrorMessages.UNKNOWN_IDENTIFIER(expr.name),
          expr.loc ?? undefined,
          Severity.Error,
        ),
      );

      return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
    })(),
  );
}

/**
 * Build a literal expression
 */
function buildLiteral(expr: Ast.Expression.Literal): Transition<Ir.Value> {
  return runGen(
    (function* () {
      // Get the type from the context
      const state = yield* gen.peek();
      const nodeType = state.types.get(expr.id);

      if (!nodeType) {
        yield* gen.addError(
          new IrgenError(
            `Cannot determine type for literal: ${expr.value}`,
            expr.loc ?? undefined,
            Severity.Error,
          ),
        );
        // Return a default value to allow compilation to continue
        return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
      }

      const type = mapTypeToIrType(nodeType);

      // Parse the literal value based on its kind
      let value: bigint | string | boolean;
      switch (expr.kind) {
        case "number":
          value = BigInt(expr.value);
          break;
        case "hex": {
          // For hex literals, check if they fit in a BigInt (up to 32 bytes / 256 bits)
          const hexValue = expr.value.startsWith("0x")
            ? expr.value.slice(2)
            : expr.value;

          // If the hex value is longer than 64 characters (32 bytes),
          // store it as a string with 0x prefix
          if (hexValue.length > 64) {
            value = expr.value.startsWith("0x")
              ? expr.value
              : `0x${expr.value}`;
          } else {
            value = BigInt(expr.value);
          }
          break;
        }
        case "address":
        case "string":
          value = expr.value;
          break;
        case "boolean":
          value = expr.value === "true";
          break;
        default:
          yield* gen.addError(
            new IrgenError(
              `Unknown literal kind: ${expr.kind}`,
              expr.loc || undefined,
              Severity.Error,
            ),
          );
          return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
      }

      const tempId = yield* gen.genTemp();

      yield* gen.emit({
        kind: "const",
        dest: tempId,
        value,
        type,
        loc: expr.loc || undefined,
      } as Ir.Instruction.Const);

      return Ir.Value.temp(tempId, type);
    })(),
  );
}

/**
 * Build an operator expression (unary or binary)
 */
function buildOperator(expr: Ast.Expression.Operator): Transition<Ir.Value> {
  return runGen(
    (function* () {
      // Get the type from the context
      const state = yield* gen.peek();
      const nodeType = state.types.get(expr.id);

      if (!nodeType) {
        yield* gen.addError(
          new IrgenError(
            `Cannot determine type for operator expression: ${expr.operator}`,
            expr.loc ?? undefined,
            Severity.Error,
          ),
        );
        return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
      }

      switch (expr.operands.length) {
        case 1:
          return yield* buildUnaryOperator(expr);
        case 2:
          return yield* buildBinaryOperator(expr);
        default: {
          yield* gen.addError(
            new IrgenError(
              `Invalid operator arity: ${expr.operands.length}`,
              expr.loc || undefined,
              Severity.Error,
            ),
          );
          return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
        }
      }
    })(),
  );
}

/**
 * Build a unary operator expression
 */
function* buildUnaryOperator(expr: Ast.Expression.Operator): IrGen<Ir.Value> {
  // Get the result type from the context
  const state = yield* gen.peek();
  const nodeType = state.types.get(expr.id);

  if (!nodeType) {
    yield* gen.addError(
      new IrgenError(
        `Cannot determine type for unary operator: ${expr.operator}`,
        expr.loc ?? undefined,
        Severity.Error,
      ),
    );
    return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
  }

  const resultType = mapTypeToIrType(nodeType);

  // Evaluate operand
  const operandVal = yield* lift(buildExpression(expr.operands[0]));

  // Generate temp for result
  const tempId = yield* gen.genTemp();

  // Map operator (matching generator.ts logic)
  const op = expr.operator === "!" ? "not" : "neg";

  // Emit unary operation
  yield* gen.emit({
    kind: "unary",
    op,
    operand: operandVal,
    dest: tempId,
    loc: expr.loc ?? undefined,
  } as Ir.Instruction.UnaryOp);

  return Ir.Value.temp(tempId, resultType);
}

/**
 * Build a binary operator expression
 */
function* buildBinaryOperator(expr: Ast.Expression.Operator): IrGen<Ir.Value> {
  // Get the result type from the context
  const state = yield* gen.peek();
  const nodeType = state.types.get(expr.id);

  if (!nodeType) {
    yield* gen.addError(
      new IrgenError(
        `Cannot determine type for binary operator: ${expr.operator}`,
        expr.loc ?? undefined,
        Severity.Error,
      ),
    );
    return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
  }

  const resultType = mapTypeToIrType(nodeType);

  // Evaluate operands
  const leftVal = yield* lift(buildExpression(expr.operands[0]));
  const rightVal = yield* lift(buildExpression(expr.operands[1]));

  // Generate temp for result
  const tempId = yield* gen.genTemp();

  // Emit binary operation
  yield* gen.emit({
    kind: "binary",
    op: mapBinaryOp(expr.operator),
    left: leftVal,
    right: rightVal,
    dest: tempId,
    loc: expr.loc ?? undefined,
  } as Ir.Instruction.BinaryOp);

  return Ir.Value.temp(tempId, resultType);
}

/**
 * Build an access expression (array/member access)
 */
function buildAccess(expr: Ast.Expression.Access): Transition<Ir.Value> {
  return runGen(
    (function* () {
      if (expr.kind === "member") {
        const property = expr.property as string;

        // Check if this is a .length property access
        if (property === "length") {
          const state = yield* gen.peek();
          const objectType = state.types.get(expr.object.id);

          // Verify that the object type supports .length (arrays, bytes, string)
          if (
            objectType &&
            (Type.isArray(objectType) ||
              (Type.isElementary(objectType) &&
                (Type.Elementary.isBytes(objectType) ||
                  Type.Elementary.isString(objectType))))
          ) {
            const object = yield* lift(buildExpression(expr.object));
            const resultType: Ir.Type = { kind: "uint", bits: 256 };
            const tempId = yield* gen.genTemp();

            yield* gen.emit({
              kind: "length",
              object,
              dest: tempId,
              loc: expr.loc ?? undefined,
            } as Ir.Instruction);

            return Ir.Value.temp(tempId, resultType);
          }
        }

        // First check if this is accessing a storage chain (e.g., accounts[user].balance)
        const chain = yield* lift(findStorageAccessChain(expr));
        if (chain) {
          const state = yield* gen.peek();
          const nodeType = state.types.get(expr.id);
          if (nodeType) {
            const valueType = mapTypeToIrType(nodeType);
            return yield* lift(
              emitStorageChainLoad(chain, valueType, expr.loc ?? undefined),
            );
          }
        }

        // Reading through local variables is allowed, no diagnostic needed

        // Otherwise, handle regular struct field access
        const object = yield* lift(buildExpression(expr.object));
        const state = yield* gen.peek();
        const objectType = state.types.get(expr.object.id);

        if (objectType && Type.isStruct(objectType)) {
          const fieldType = objectType.fields.get(property);
          if (fieldType) {
            const fieldIndex = Array.from(objectType.fields.keys()).indexOf(
              property,
            );
            const irFieldType = mapTypeToIrType(fieldType);
            const tempId = yield* gen.genTemp();

            yield* gen.emit({
              kind: "load_field",
              object,
              field: property,
              fieldIndex,
              type: irFieldType,
              dest: tempId,
              loc: expr.loc ?? undefined,
            } as Ir.Instruction);

            return Ir.Value.temp(tempId, irFieldType);
          }
        }
      } else if (expr.kind === "slice") {
        // Slice access - start:end
        const state = yield* gen.peek();
        const objectType = state.types.get(expr.object.id);
        if (
          objectType &&
          Type.isElementary(objectType) &&
          Type.Elementary.isBytes(objectType)
        ) {
          const object = yield* lift(buildExpression(expr.object));
          const start = yield* lift(
            buildExpression(expr.property as Ast.Expression),
          );
          const end = yield* lift(buildExpression(expr.end!));

          // Slicing bytes returns dynamic bytes
          const resultType: Ir.Type = { kind: "bytes" };
          const tempId = yield* gen.genTemp();

          yield* gen.emit({
            kind: "slice",
            object,
            start,
            end,
            dest: tempId,
            loc: expr.loc ?? undefined,
          } as Ir.Instruction);

          return Ir.Value.temp(tempId, resultType);
        }

        yield* gen.addError(
          new IrgenError(
            "Only bytes types can be sliced",
            expr.loc ?? undefined,
            Severity.Error,
          ),
        );
        return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
      } else {
        // Array/mapping/bytes index access
        // First check if we're indexing into bytes (not part of storage chain)
        const state = yield* gen.peek();
        const objectType = state.types.get(expr.object.id);
        if (
          objectType &&
          Type.isElementary(objectType) &&
          Type.Elementary.isBytes(objectType)
        ) {
          // Handle bytes indexing directly, not as storage chain
          const object = yield* lift(buildExpression(expr.object));
          const index = yield* lift(
            buildExpression(expr.property as Ast.Expression),
          );

          // Bytes indexing returns uint8
          const elementType: Ir.Type = { kind: "uint", bits: 8 };
          const tempId = yield* gen.genTemp();

          yield* gen.emit({
            kind: "load_index",
            array: object,
            index,
            elementType,
            dest: tempId,
            loc: expr.loc ?? undefined,
          } as Ir.Instruction);

          return Ir.Value.temp(tempId, elementType);
        }

        // For non-bytes types, try to find a complete storage access chain
        const chain = yield* lift(findStorageAccessChain(expr));
        if (chain) {
          const nodeType = state.types.get(expr.id);
          if (nodeType) {
            const valueType = mapTypeToIrType(nodeType);
            return yield* lift(
              emitStorageChainLoad(chain, valueType, expr.loc ?? undefined),
            );
          }
        }

        // If no storage chain, handle regular array/mapping access
        const object = yield* lift(buildExpression(expr.object));
        const index = yield* lift(
          buildExpression(expr.property as Ast.Expression),
        );

        if (objectType && Type.isArray(objectType)) {
          const elementType = mapTypeToIrType(objectType.element);
          const tempId = yield* gen.genTemp();

          yield* gen.emit({
            kind: "load_index",
            array: object,
            index,
            elementType,
            dest: tempId,
            loc: expr.loc ?? undefined,
          } as Ir.Instruction);

          return Ir.Value.temp(tempId, elementType);
        } else if (objectType && Type.isMapping(objectType)) {
          // Simple mapping access
          const storageVar = yield* lift(findStorageVariable(expr.object));
          if (storageVar) {
            const valueType = mapTypeToIrType(objectType.value);
            const tempId = yield* gen.genTemp();

            yield* gen.emit({
              kind: "load_mapping",
              slot: storageVar.slot,
              key: index,
              valueType,
              dest: tempId,
              loc: expr.loc ?? undefined,
            } as Ir.Instruction);

            return Ir.Value.temp(tempId, valueType);
          }
        }
      }

      yield* gen.addError(
        new IrgenError(
          "Invalid access expression",
          expr.loc ?? undefined,
          Severity.Error,
        ),
      );
      return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
    })(),
  );
}

/**
 * Build a call expression
 */
function buildCall(expr: Ast.Expression.Call): Transition<Ir.Value> {
  return runGen(
    (function* () {
      // Check if this is a built-in function call
      if (
        expr.callee.type === "IdentifierExpression" &&
        (expr.callee as Ast.Expression.Identifier).name === "keccak256"
      ) {
        // keccak256 built-in function
        if (expr.arguments.length !== 1) {
          yield* gen.addError(
            new IrgenError(
              "keccak256 expects exactly 1 argument",
              expr.loc ?? undefined,
              Severity.Error,
            ),
          );
          return Ir.Value.constant(0n, { kind: "bytes", size: 32 });
        }

        // Evaluate the argument
        const argValue = yield* lift(buildExpression(expr.arguments[0]));

        // Generate hash instruction
        const resultType: Ir.Type = { kind: "bytes", size: 32 }; // bytes32
        const resultTemp = yield* gen.genTemp();

        yield* gen.emit({
          kind: "hash",
          value: argValue,
          dest: resultTemp,
          loc: expr.loc ?? undefined,
        } as Ir.Instruction);

        return Ir.Value.temp(resultTemp, resultType);
      }

      // Handle user-defined function calls
      if (expr.callee.type === "IdentifierExpression") {
        const functionName = (expr.callee as Ast.Expression.Identifier).name;

        // Get the function type from the type checker
        const state = yield* gen.peek();
        const callType = state.types.get(expr.id);

        if (!callType) {
          yield* gen.addError(
            new IrgenError(
              `Unknown function: ${functionName}`,
              expr.loc ?? undefined,
              Severity.Error,
            ),
          );
          return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
        }

        // Evaluate arguments
        const argValues: Ir.Value[] = [];
        for (const arg of expr.arguments) {
          argValues.push(yield* lift(buildExpression(arg)));
        }

        // Generate call instruction
        const irType = mapTypeToIrType(callType);
        let dest: string | undefined;

        // Only create a destination if the function returns a value
        // Check if it's a void function by checking if the type is a failure with "void function" message
        const isVoidFunction =
          Type.isFailure(callType) &&
          (callType as Type.Failure).reason === "void function";

        if (!isVoidFunction) {
          dest = yield* gen.genTemp();
        }

        yield* gen.emit({
          kind: "call",
          function: functionName,
          arguments: argValues,
          dest,
          loc: expr.loc ?? undefined,
        } as Ir.Instruction.Call);

        // Return the result value or a dummy value for void functions
        if (dest) {
          return Ir.Value.temp(dest, irType);
        } else {
          // Void function - return a dummy value
          return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
        }
      }

      // Other forms of function calls not supported
      yield* gen.addError(
        new IrgenError(
          "Complex function call expressions not yet supported",
          expr.loc ?? undefined,
          Severity.Error,
        ),
      );
      return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
    })(),
  );
}

/**
 * Build a cast expression
 */
function buildCast(expr: Ast.Expression.Cast): Transition<Ir.Value> {
  return runGen(
    (function* () {
      // Evaluate the expression being cast
      const exprValue = yield* lift(buildExpression(expr.expression));

      // Get the target type from the type checker
      const state = yield* gen.peek();
      const targetType = state.types.get(expr.id);

      if (!targetType) {
        yield* gen.addError(
          new IrgenError(
            "Cannot determine target type for cast expression",
            expr.loc ?? undefined,
            Severity.Error,
          ),
        );
        return exprValue; // Return the original value
      }

      const targetIrType = mapTypeToIrType(targetType);

      // For now, we'll generate a cast instruction that will be handled during bytecode generation
      // In many cases, the cast is a no-op at the IR level (e.g., uint256 to address)
      const resultTemp = yield* gen.genTemp();

      yield* gen.emit({
        kind: "cast",
        value: exprValue,
        targetType: targetIrType,
        dest: resultTemp,
        loc: expr.loc || undefined,
      } as Ir.Instruction.Cast);

      return Ir.Value.temp(resultTemp, targetIrType);
    })(),
  );
}

/**
 * Build a special expression (msg.sender, block.number, etc.)
 */
function buildSpecial(expr: Ast.Expression.Special): Transition<Ir.Value> {
  return runGen(
    (function* () {
      // Get the type from the type checker
      const state = yield* gen.peek();
      const nodeType = state.types.get(expr.id);

      if (!nodeType) {
        yield* gen.addError(
          new IrgenError(
            `Cannot determine type for special expression: ${expr.kind}`,
            expr.loc ?? undefined,
            Severity.Error,
          ),
        );
        // Return a default value to allow compilation to continue
        return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
      }

      const resultType = mapTypeToIrType(nodeType);
      const temp = yield* gen.genTemp();

      let op: Ir.Instruction.Env["op"];
      switch (expr.kind) {
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
          yield* gen.addError(
            new IrgenError(
              `Unknown special expression: ${expr.kind}`,
              expr.loc || undefined,
              Severity.Error,
            ),
          );
          return Ir.Value.constant(0n, { kind: "uint", bits: 256 });
      }

      yield* gen.emit({
        kind: "env",
        op,
        dest: temp,
        loc: expr.loc ?? undefined,
      } as Ir.Instruction.Env);

      return Ir.Value.temp(temp, resultType);
    })(),
  );
}

/**
 * Build a storage load
 */
function buildStorageLoad(
  slot: Ir.Module.StorageSlot,
  expr: Ast.Expression,
): Transition<Ir.Value> {
  return pipe()
    .then(operations.genTemp())
    .peek(
      (_state, tempId): IrBuilder<Ir.Value> =>
        pipe()
          .then(
            operations.emit({
              kind: "load_storage",
              slot: Ir.Value.constant(BigInt(slot.slot), {
                kind: "uint",
                bits: 256,
              }),
              type: slot.type,
              dest: tempId,
              loc: expr.loc || undefined,
            } as Ir.Instruction.LoadStorage),
          )
          .then((state) => ({
            state,
            value: Ir.Value.temp(tempId, slot.type),
          })),
    )
    .done();
}

// Helper functions

// Storage access chain interface (matching generator.ts)
interface StorageAccessChain {
  slot: Ir.Module.StorageSlot;
  accesses: Array<{
    kind: "index" | "member";
    key?: Ir.Value; // For index access
    fieldName?: string; // For member access
    fieldIndex?: number; // For member access
  }>;
}

/**
 * Find a storage access chain starting from an expression (matching generator.ts)
 * Returns a Transition that evaluates to the chain or undefined
 */
function findStorageAccessChain(
  expr: Ast.Expression,
): Transition<StorageAccessChain | undefined> {
  return (state: IrState) => {
    const accesses: StorageAccessChain["accesses"] = [];
    let current = expr;
    let currentState = state;

    // Walk up the access chain from right to left
    while (current.type === "AccessExpression") {
      const accessNode = current as Ast.Expression.Access;

      if (accessNode.kind === "index") {
        // For index access, we need to evaluate the key expression
        const keyResult = buildExpression(
          accessNode.property as Ast.Expression,
        )(currentState);
        currentState = keyResult.state;
        const key = keyResult.value;
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
      const slot = currentState.module.storage.slots.find(
        (s) => s.name === name,
      );
      if (slot) {
        return { state: currentState, value: { slot, accesses } };
      }

      // Check if it's a local variable (which means we're trying to access
      // storage through an intermediate variable - not supported)
      const localResult = operations.lookupVariable(name)(currentState);
      currentState = localResult.state;
      const local = localResult.value;

      if (local && accesses.length > 0) {
        // Get the type to provide better error message
        const localType = currentState.types.get(current.id);
        const typeDesc = localType
          ? (localType as Type & { name?: string; kind?: string }).name ||
            (localType as Type & { name?: string; kind?: string }).kind ||
            "complex"
          : "unknown";

        currentState = addError(
          currentState,
          new IrgenError(
            ErrorMessages.STORAGE_MODIFICATION_ERROR(name, typeDesc),
            expr.loc ?? undefined,
            Severity.Error,
          ),
        );
      }
    } else if (current.type === "CallExpression") {
      // Provide specific error for function calls
      currentState = addError(
        currentState,
        new IrgenError(
          ErrorMessages.UNSUPPORTED_STORAGE_PATTERN("function return values"),
          expr.loc || undefined,
          Severity.Error,
        ),
      );
    } else if (accesses.length > 0) {
      // Other unsupported base expressions when we have an access chain
      currentState = addError(
        currentState,
        new IrgenError(
          `Storage access chain must start with a storage variable identifier. ` +
            `Found ${current.type} at the base of the access chain.`,
          current.loc ?? undefined,
          Severity.Error,
        ),
      );
    }

    return { state: currentState, value: undefined };
  };
}

/**
 * Find a storage variable from an expression
 */
function findStorageVariable(
  expr: Ast.Expression,
): Transition<Ir.Module.StorageSlot | undefined> {
  return runGen(
    (function* () {
      if (expr.type === "IdentifierExpression") {
        const name = (expr as Ast.Expression.Identifier).name;
        const state = yield* gen.peek();
        return state.module.storage.slots.find((s) => s.name === name);
      }
      return undefined;
    })(),
  );
}

/**
 * Emit a storage chain load (matching generator.ts pattern)
 */
function emitStorageChainLoad(
  chain: StorageAccessChain,
  valueType: Ir.Type,
  loc: Ast.SourceLocation | undefined,
): Transition<Ir.Value> {
  return runGen(
    (function* () {
      let currentSlot = Ir.Value.constant(BigInt(chain.slot.slot), {
        kind: "uint",
        bits: 256,
      });
      let currentType = chain.slot.type;

      // Process each access in the chain
      for (const access of chain.accesses) {
        if (access.kind === "index" && access.key) {
          // For mapping/array access
          const tempId = yield* gen.genTemp();
          yield* gen.emit({
            kind: "compute_slot",
            baseSlot: currentSlot,
            key: access.key,
            dest: tempId,
            loc,
          } as Ir.Instruction);

          currentSlot = Ir.Value.temp(tempId, { kind: "uint", bits: 256 });

          // Update type based on mapping/array element type
          if (currentType.kind === "mapping") {
            currentType = currentType.value || { kind: "uint", bits: 256 };
          } else if (currentType.kind === "array") {
            currentType = currentType.element || { kind: "uint", bits: 256 };
          }
        } else if (access.kind === "member" && access.fieldName) {
          // For struct field access
          if (currentType.kind === "struct") {
            const fieldIndex =
              currentType.fields.findIndex(
                ({ name }) => name === access.fieldName,
              ) ?? 0;

            const tempId = yield* gen.genTemp();
            yield* gen.emit({
              kind: "compute_field_offset",
              baseSlot: currentSlot,
              fieldIndex,
              dest: tempId,
              loc,
            } as Ir.Instruction);

            currentSlot = Ir.Value.temp(tempId, { kind: "uint", bits: 256 });
            currentType = currentType.fields[fieldIndex]?.type || {
              kind: "uint",
              bits: 256,
            };
          }
        }
      }

      // Generate the final load_storage instruction
      const loadTempId = yield* gen.genTemp();
      yield* gen.emit({
        kind: "load_storage",
        slot: currentSlot,
        type: valueType,
        dest: loadTempId,
        loc,
      } as Ir.Instruction.LoadStorage);

      return Ir.Value.temp(loadTempId, valueType);
    })(),
  );
}

function mapTypeToIrType(type: Type): Ir.Type {
  if (!type) {
    return { kind: "uint", bits: 256 };
  }

  // The type is from the types module, not an AST type
  switch (type.kind) {
    case "uint":
      return { kind: "uint", bits: type.bits || 256 };
    case "int":
      return { kind: "int", bits: type.bits || 256 };
    case "bool":
      return { kind: "bool" };
    case "address":
      return { kind: "address" };
    case "bytes":
      return { kind: "bytes", size: type.bits ? type.bits / 8 : 32 };
    case "string":
      return { kind: "bytes", size: 32 }; // Simplified
    case "array": {
      const arrayType = type as Type.Array;
      return {
        kind: "array",
        element: mapTypeToIrType(arrayType.element),
        size: arrayType.size,
      } as Ir.Type;
    }
    case "mapping": {
      const mappingType = type as Type.Mapping;
      return {
        kind: "mapping",
        key: mapTypeToIrType(mappingType.key),
        value: mapTypeToIrType(mappingType.value),
      } as Ir.Type;
    }
    case "struct": {
      const structType = type as Type.Struct;
      const fields: Ir.Type.StructField[] = [];
      let offset = 0;
      for (const [name, fieldType] of structType.fields) {
        fields.push({
          name,
          type: mapTypeToIrType(fieldType),
          offset,
        });
        offset += 32; // Simplified - each field takes 32 bytes
      }
      return {
        kind: "struct",
        name: structType.name,
        fields,
      } as Ir.Type;
    }
    default:
      return { kind: "uint", bits: 256 };
  }
}

function mapBinaryOp(op: string): Ir.Instruction.BinaryOp["op"] {
  const opMap: Record<string, Ir.Instruction.BinaryOp["op"]> = {
    "+": "add",
    "-": "sub",
    "*": "mul",
    "/": "div",
    "%": "mod",
    "==": "eq",
    "!=": "ne",
    "<": "lt",
    "<=": "le",
    ">": "gt",
    ">=": "ge",
    "&&": "and",
    "||": "or",
  };
  return opMap[op] || "add";
}
