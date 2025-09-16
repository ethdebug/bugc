import type * as Ast from "#ast";
import * as Ir from "#ir";
import { Type } from "#types";
import type { IrState, Transition } from "./state.js";
import { Error as IrgenError, ErrorCode } from "./errors.js";
import { Severity } from "#result";
import { pipe } from "./builder.js";
import { operations } from "./operations.js";
import { addError } from "./updates.js";
import { buildExpression } from "./expressions/index.js";
import { makeFindStorageAccessChain } from "./storage.js";
import { type IrGen, gen, lift, runGen } from "./irgen.js";

const findStorageAccessChain = makeFindStorageAccessChain(buildExpression);

/**
 * Build a statement
 */
export function buildStatement(stmt: Ast.Statement): Transition<void> {
  switch (stmt.type) {
    case "DeclarationStatement":
      return buildDeclarationStatement(stmt as Ast.Statement.Declare);
    case "AssignmentStatement":
      return buildAssignmentStatement(stmt as Ast.Statement.Assign);
    case "ControlFlowStatement":
      return buildControlFlowStatement(stmt as Ast.Statement.ControlFlow);
    case "ExpressionStatement":
      return buildExpressionStatement(stmt as Ast.Statement.Express);
    default:
      return (state) => ({
        state: addError(
          state,
          new IrgenError(
            // @ts-expect-error switch statement is exhaustive
            `Unsupported statement type: ${stmt.type}`,
            // @ts-expect-error switch statement is exhaustive
            stmt.loc ?? undefined,
            Severity.Error,
          ),
        ),
        value: undefined,
      });
  }
}

/**
 * Build a declaration statement
 */
function buildDeclarationStatement(
  stmt: Ast.Statement.Declare,
): Transition<void> {
  const decl = stmt.declaration;

  switch (decl.kind) {
    case "variable":
      return buildVariableDeclaration(decl as Ast.Declaration.Variable);
    case "function":
      // Function declarations are handled at module level
      return (state) => ({ state, value: undefined });
    case "struct":
      // Struct declarations are handled at module level
      return (state) => ({ state, value: undefined });
    case "storage":
      // Storage declarations are handled at module level
      return (state) => ({ state, value: undefined });
    default:
      return (state) => ({
        state: addError(
          state,
          new IrgenError(
            `Unsupported declaration kind: ${decl.kind}`,
            stmt.loc ?? undefined,
            Severity.Error,
          ),
        ),
        value: undefined,
      });
  }
}

/**
 * Build a variable declaration
 */
function buildVariableDeclaration(
  decl: Ast.Declaration.Variable,
): Transition<void> {
  return pipe()
    .then((state: IrState) => {
      // Infer type from the types map or use default
      const type = state.types.get(decl.id);
      const irType = type
        ? mapTypeToIrType(type)
        : ({ kind: "uint", bits: 256 } as Ir.Type);

      // Declare the local variable
      return operations.declareLocal(decl.name, irType)(state);
    })
    .peek((_state, local) => {
      if (!local) {
        return pipe();
      }

      // If there's an initializer, evaluate it and assign
      if (decl.initializer) {
        return pipe()
          .then(runGen(buildExpression(decl.initializer)))
          .peek((_state2, value) =>
            pipe().then(
              operations.emit({
                kind: "store_local",
                local: local.id,
                value,
                loc: decl.loc ?? undefined,
              } as Ir.Instruction.StoreLocal),
            ),
          );
      }

      return pipe();
    })
    .done();
}

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
 * Emit a storage chain assignment
 */
function emitStorageChainAssignment(
  chain: StorageAccessChain,
  value: Ir.Value,
  loc: Ast.SourceLocation | undefined,
): Transition<void> {
  return runGen(
    (function* () {
      if (chain.accesses.length === 0) {
        // Direct storage assignment
        yield* gen.emit({
          kind: "store_storage",
          slot: Ir.Value.constant(BigInt(chain.slot.slot), {
            kind: "uint",
            bits: 256,
          }),
          value,
          loc,
        } as Ir.Instruction);
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
            const slotTemp = yield* gen.genTemp();
            yield* gen.emit({
              kind: "compute_slot",
              baseSlot: currentSlot,
              key: access.key,
              dest: slotTemp,
              loc,
            } as Ir.Instruction);
            currentSlot = Ir.Value.temp(slotTemp, { kind: "uint", bits: 256 });
            currentType = (currentType as { kind: "mapping"; value: Ir.Type })
              .value;
          } else if (currentType.kind === "array") {
            // Array access
            const baseSlotTemp = yield* gen.genTemp();
            yield* gen.emit({
              kind: "compute_array_slot",
              baseSlot: currentSlot,
              dest: baseSlotTemp,
              loc,
            } as Ir.Instruction);

            // Add the index to get the final slot
            const finalSlotTemp = yield* gen.genTemp();
            yield* gen.emit({
              kind: "binary",
              op: "add",
              left: Ir.Value.temp(baseSlotTemp, { kind: "uint", bits: 256 }),
              right: access.key,
              dest: finalSlotTemp,
              loc,
            } as Ir.Instruction);

            currentSlot = Ir.Value.temp(finalSlotTemp, {
              kind: "uint",
              bits: 256,
            });
            currentType = (currentType as { kind: "array"; element: Ir.Type })
              .element;
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
              const offsetTemp = yield* gen.genTemp();
              yield* gen.emit({
                kind: "compute_field_offset",
                baseSlot: currentSlot,
                fieldIndex,
                dest: offsetTemp,
                loc,
              } as Ir.Instruction);
              currentSlot = Ir.Value.temp(offsetTemp, {
                kind: "uint",
                bits: 256,
              });
              currentType = structType.fields[fieldIndex].type;
            } else {
              yield* gen.addError(
                new IrgenError(
                  `Field ${access.fieldName} not found in struct ${structType.name}`,
                  loc,
                  Severity.Error,
                ),
              );
            }
          }
        }
      }

      // Store to the computed slot
      yield* gen.emit({
        kind: "store_storage",
        slot: currentSlot,
        value,
        loc,
      } as Ir.Instruction);
    })(),
  );
}

/**
 * Handle lvalue assignment
 */
function* buildLValue(node: Ast.Expression, value: Ir.Value): IrGen<void> {
  if (node.type === "IdentifierExpression") {
    const name = (node as Ast.Expression.Identifier).name;

    // Check if it's a local
    const local = yield* gen.lookupVariable(name);
    if (local) {
      yield* gen.emit({
        kind: "store_local",
        local: local.id,
        value,
        loc: node.loc ?? undefined,
      } as Ir.Instruction);
      return;
    }

    // Check if it's storage
    const state = yield* gen.peek();
    const storageSlot = state.module.storage.slots.find((s) => s.name === name);
    if (storageSlot) {
      yield* gen.emit({
        kind: "store_storage",
        slot: Ir.Value.constant(BigInt(storageSlot.slot), {
          kind: "uint",
          bits: 256,
        }),
        value,
        loc: node.loc ?? undefined,
      } as Ir.Instruction);
      return;
    }

    yield* gen.addError(
      new IrgenError(
        `Unknown identifier: ${name}`,
        node.loc || undefined,
        Severity.Error,
      ),
    );
    return;
  } else if (node.type === "AccessExpression") {
    const accessNode = node as Ast.Expression.Access;

    if (accessNode.kind === "member") {
      // First check if this is a storage chain assignment
      const chain = yield* findStorageAccessChain(node);
      if (chain) {
        yield* lift(
          emitStorageChainAssignment(chain, value, node.loc ?? undefined),
        );
        return;
      }

      // Otherwise, handle regular struct field assignment
      const object = yield* buildExpression(accessNode.object);
      const state = yield* gen.peek();
      const objectType = state.types.get(accessNode.object.id);

      if (objectType && Type.isStruct(objectType)) {
        const fieldName = accessNode.property as string;
        const fieldType = objectType.fields.get(fieldName);
        if (fieldType) {
          // Find field index
          let fieldIndex = 0;
          for (const [name] of objectType.fields) {
            if (name === fieldName) break;
            fieldIndex++;
          }

          yield* gen.emit({
            kind: "store_field",
            object,
            field: fieldName,
            fieldIndex,
            value,
            loc: node.loc ?? undefined,
          } as Ir.Instruction);
          return;
        }
      }
    } else {
      // Array/mapping/bytes assignment
      // First check if we're assigning to bytes
      const state = yield* gen.peek();
      const objectType = state.types.get(accessNode.object.id);
      if (
        objectType &&
        Type.isElementary(objectType) &&
        Type.Elementary.isBytes(objectType)
      ) {
        // Handle bytes indexing directly
        const object = yield* buildExpression(accessNode.object);
        const index = yield* buildExpression(
          accessNode.property as Ast.Expression,
        );

        yield* gen.emit({
          kind: "store_index",
          array: object,
          index,
          value,
          loc: node.loc ?? undefined,
        } as Ir.Instruction);
        return;
      }

      // For non-bytes types, try to find a complete storage access chain
      const chain = yield* findStorageAccessChain(node);
      if (chain) {
        yield* lift(
          emitStorageChainAssignment(chain, value, node.loc ?? undefined),
        );
        return;
      }

      // If no storage chain, handle regular array/mapping access
      const object = yield* buildExpression(accessNode.object);
      const index = yield* buildExpression(
        accessNode.property as Ast.Expression,
      );

      if (objectType && Type.isArray(objectType)) {
        yield* gen.emit({
          kind: "store_index",
          array: object,
          index,
          value,
          loc: node.loc ?? undefined,
        } as Ir.Instruction);
        return;
      }
    }
  }

  yield* gen.addError(
    new IrgenError("Invalid lvalue", node.loc || undefined, Severity.Error),
  );
}

/**
 * Build an assignment statement
 */
function buildAssignmentStatement(
  stmt: Ast.Statement.Assign,
): Transition<void> {
  return runGen(
    (function* () {
      const value = yield* buildExpression(stmt.value);
      yield* buildLValue(stmt.target, value);
    })(),
  );
}

/**
 * Build a control flow statement
 */
function buildControlFlowStatement(
  stmt: Ast.Statement.ControlFlow,
): Transition<void> {
  switch (stmt.kind) {
    case "if":
      return buildIfStatement(stmt);
    case "while":
      return buildWhileStatement(stmt);
    case "for":
      return buildForStatement(stmt);
    case "return":
      return buildReturnStatement(stmt);
    case "break":
      return buildBreakStatement(stmt);
    case "continue":
      return buildContinueStatement(stmt);
    default:
      return (state) => ({
        state: addError(
          state,
          new IrgenError(
            `Unsupported control flow: ${stmt.kind}`,
            stmt.loc ?? undefined,
            Severity.Error,
          ),
        ),
        value: undefined,
      });
  }
}

/**
 * Build an if statement
 */
function buildIfStatement(stmt: Ast.Statement.ControlFlow): Transition<void> {
  if (stmt.alternate) {
    // If-else statement
    return pipe()
      .then(operations.createBlock("then"))
      .peek((_state, thenBlock) =>
        pipe()
          .then(operations.createBlock("else"))
          .peek((_state2, elseBlock) =>
            pipe()
              .then(operations.createBlock("merge"))
              .peek((_state3, mergeBlock) =>
                pipe()
                  // Evaluate condition
                  .then(runGen(buildExpression(stmt.condition!)))
                  .peek((_state4, condVal) =>
                    pipe()
                      // Branch to then or else
                      .then(
                        operations.setTerminator({
                          kind: "branch",
                          condition: condVal,
                          trueTarget: thenBlock,
                          falseTarget: elseBlock,
                        }),
                      )
                      // Build then block
                      .then(operations.switchToBlock(thenBlock))
                      .then(buildBlock(stmt.body!))
                      .then((state: IrState) => {
                        // Only set terminator if block doesn't have one
                        if (!state.block.terminator) {
                          return operations.setTerminator({
                            kind: "jump",
                            target: mergeBlock,
                          })(state);
                        }
                        return { state, value: undefined };
                      })
                      // Build else block
                      .then(operations.switchToBlock(elseBlock))
                      .then(buildBlock(stmt.alternate!))
                      .then((state: IrState) => {
                        // Only set terminator if block doesn't have one
                        if (!state.block.terminator) {
                          return operations.setTerminator({
                            kind: "jump",
                            target: mergeBlock,
                          })(state);
                        }
                        return { state, value: undefined };
                      })
                      // Continue in merge block
                      .then(operations.switchToBlock(mergeBlock))
                      .then(operations.addPredecessor(thenBlock))
                      .then(operations.addPredecessor(elseBlock)),
                  ),
              ),
          ),
      )
      .done();
  } else {
    // Simple if statement (no else)
    return pipe()
      .then(operations.createBlock("then"))
      .peek((_state, thenBlock) =>
        pipe()
          .then(operations.createBlock("merge"))
          .peek((_state2, mergeBlock) =>
            pipe()
              // Evaluate condition
              .then(runGen(buildExpression(stmt.condition!)))
              .peek((_state3, condVal) =>
                pipe()
                  // Branch to then or merge
                  .then(
                    operations.setTerminator({
                      kind: "branch",
                      condition: condVal,
                      trueTarget: thenBlock,
                      falseTarget: mergeBlock,
                    }),
                  )
                  // Build then block
                  .then(operations.switchToBlock(thenBlock))
                  .then(buildBlock(stmt.body!))
                  .then((state: IrState) => {
                    // Only set terminator if block doesn't have one
                    if (!state.block.terminator) {
                      return operations.setTerminator({
                        kind: "jump",
                        target: mergeBlock,
                      })(state);
                    }
                    return { state, value: undefined };
                  })
                  // Continue in merge block
                  .then(operations.switchToBlock(mergeBlock))
                  .then(operations.addPredecessor(thenBlock)),
              ),
          ),
      )
      .done();
  }
}

/**
 * Build a while statement
 */
function buildWhileStatement(
  stmt: Ast.Statement.ControlFlow,
): Transition<void> {
  return pipe()
    .then(operations.createBlock("while_header"))
    .peek((_state, headerBlock) =>
      pipe()
        .then(operations.createBlock("while_body"))
        .peek((_state2, bodyBlock) =>
          pipe()
            .then(operations.createBlock("while_exit"))
            .peek((_state3, exitBlock) =>
              pipe()
                // Jump to loop header
                .then(
                  operations.setTerminator({
                    kind: "jump",
                    target: headerBlock,
                  }),
                )
                // Loop header: check condition
                .then(operations.switchToBlock(headerBlock))
                .then(runGen(buildExpression(stmt.condition!)))
                .peek((_state4, condVal) =>
                  pipe()
                    .then(
                      operations.setTerminator({
                        kind: "branch",
                        condition: condVal,
                        trueTarget: bodyBlock,
                        falseTarget: exitBlock,
                      }),
                    )
                    // Loop body
                    .then(operations.switchToBlock(bodyBlock))
                    .then(operations.pushLoop(headerBlock, exitBlock))
                    .then(buildBlock(stmt.body!))
                    .then(operations.popLoop())
                    .then(
                      operations.setTerminator({
                        kind: "jump",
                        target: headerBlock,
                      }),
                    )
                    // Continue after loop
                    .then(operations.switchToBlock(exitBlock)),
                ),
            ),
        ),
    )
    .done();
}

/**
 * Build a for statement
 */
function buildForStatement(stmt: Ast.Statement.ControlFlow): Transition<void> {
  return (
    pipe()
      // Execute initializer
      .then(
        stmt.init
          ? buildStatement(stmt.init)
          : (state: IrState) => ({ state, value: undefined }),
      )
      // Create loop blocks
      .then(operations.createBlock("for_header"))
      .peek((_state, headerBlock) =>
        pipe()
          .then(operations.createBlock("for_body"))
          .peek((_state2, bodyBlock) =>
            pipe()
              .then(operations.createBlock("for_update"))
              .peek((_state3, updateBlock) =>
                pipe()
                  .then(operations.createBlock("for_exit"))
                  .peek((_state4, exitBlock) =>
                    pipe()
                      // Jump to loop header
                      .then(
                        operations.setTerminator({
                          kind: "jump",
                          target: headerBlock,
                        }),
                      )
                      // Loop header: check condition
                      .then(operations.switchToBlock(headerBlock))
                      .then(
                        stmt.condition
                          ? runGen(buildExpression(stmt.condition))
                          : (state: IrState) => ({
                              state,
                              value: Ir.Value.constant(1n, { kind: "bool" }),
                            }),
                      )
                      .peek((_state5, condVal) =>
                        pipe()
                          .then(
                            operations.setTerminator({
                              kind: "branch",
                              condition: condVal,
                              trueTarget: bodyBlock,
                              falseTarget: exitBlock,
                            }),
                          )
                          // Loop body
                          .then(operations.switchToBlock(bodyBlock))
                          .then(operations.pushLoop(updateBlock, exitBlock))
                          .then(buildBlock(stmt.body!))
                          .then(operations.popLoop())
                          .then((state: IrState) => {
                            // Only set terminator if block doesn't have one
                            if (!state.block.terminator) {
                              return operations.setTerminator({
                                kind: "jump",
                                target: updateBlock,
                              })(state);
                            }
                            return { state, value: undefined };
                          })
                          // Update block
                          .then(operations.switchToBlock(updateBlock))
                          .then(
                            stmt.update
                              ? buildStatement(stmt.update)
                              : (state: IrState) => ({
                                  state,
                                  value: undefined,
                                }),
                          )
                          .then((state: IrState) => {
                            // Only set terminator if block doesn't have one
                            if (!state.block.terminator) {
                              return operations.setTerminator({
                                kind: "jump",
                                target: headerBlock,
                              })(state);
                            }
                            return { state, value: undefined };
                          })
                          // Continue after loop
                          .then(operations.switchToBlock(exitBlock)),
                      ),
                  ),
              ),
          ),
      )
      .done()
  );
}

/**
 * Build a return statement
 */
function buildReturnStatement(
  stmt: Ast.Statement.ControlFlow,
): Transition<void> {
  if (stmt.value) {
    return pipe()
      .then(runGen(buildExpression(stmt.value)))
      .peek((_state, value) =>
        pipe().then(
          operations.setTerminator({
            kind: "return",
            value,
          }),
        ),
      )
      .done();
  }

  return operations.setTerminator({
    kind: "return",
    value: undefined,
  });
}

/**
 * Build a break statement
 */
function buildBreakStatement(
  stmt: Ast.Statement.ControlFlow,
): Transition<void> {
  return pipe()
    .then(operations.getCurrentLoop())
    .peek((_state, loop) => {
      if (!loop) {
        return pipe().then((state: IrState) => ({
          state: addError(
            state,
            new IrgenError(
              "Break outside loop",
              stmt.loc ?? undefined,
              Severity.Error,
            ),
          ),
          value: undefined,
        }));
      }

      return pipe().then(
        operations.setTerminator({
          kind: "jump",
          target: loop.breakTarget,
        }),
      );
    })
    .done();
}

/**
 * Build a continue statement
 */
function buildContinueStatement(
  stmt: Ast.Statement.ControlFlow,
): Transition<void> {
  return pipe()
    .then(operations.getCurrentLoop())
    .peek((_state, loop) => {
      if (!loop) {
        return pipe().then((state: IrState) => ({
          state: addError(
            state,
            new IrgenError(
              "Continue outside loop",
              stmt.loc ?? undefined,
              Severity.Error,
            ),
          ),
          value: undefined,
        }));
      }

      return pipe().then(
        operations.setTerminator({
          kind: "jump",
          target: loop.continueTarget,
        }),
      );
    })
    .done();
}

/**
 * Build an expression statement
 */
function buildExpressionStatement(
  stmt: Ast.Statement.Express,
): Transition<void> {
  return pipe()
    .then(runGen(buildExpression(stmt.expression)))
    .then((state) => ({ state, value: undefined }))
    .done();
}

/**
 * Build a block of statements
 */
export function buildBlock(block: Ast.Block): Transition<void> {
  return pipe()
    .then(operations.pushScope())
    .then((state: IrState) => {
      // Build all statements in sequence
      let currentState = state;

      for (const item of block.items) {
        if ("type" in item && isStatement(item)) {
          const { state: newState } = buildStatement(item as Ast.Statement)(
            currentState,
          );
          currentState = newState;
        }
      }

      return { state: currentState, value: undefined };
    })
    .then(operations.popScope())
    .done();
}

// Helper functions

function isStatement(node: unknown): node is Ast.Statement {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    typeof (node as { type: unknown }).type === "string" &&
    [
      "DeclarationStatement",
      "AssignmentStatement",
      "ControlFlowStatement",
      "ExpressionStatement",
    ].includes((node as { type: string }).type)
  );
}

function mapTypeToIrType(type: Type): Ir.Type {
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
