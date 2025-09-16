import * as Ast from "#ast";
import * as Ir from "#ir";
import { Error as IrgenError } from "../errors.js";
import { Severity } from "#result";
import { buildExpression } from "../expressions/index.js";

import { makeBuildBlock } from "./block.js";
import {
  type IrGen,
  addError,
  setTerminator,
  getCurrentLoop,
  updateCounters,
  updateBlock,
  pushLoop,
  popLoop,
  syncBlockToFunction,
  peek,
} from "../irgen.js";

/**
 * Build a control flow statement
 */
export const makeBuildControlFlowStatement = (
  buildStatement: (stmt: Ast.Statement) => IrGen<void>,
) => {
  const buildIfStatement = makeBuildIfStatement(buildStatement);
  const buildWhileStatement = makeBuildWhileStatement(buildStatement);
  const buildForStatement = makeBuildForStatement(buildStatement);

  return function* buildControlFlowStatement(
    stmt: Ast.Statement.ControlFlow,
  ): IrGen<void> {
    switch (stmt.kind) {
      case "if":
        return yield* buildIfStatement(stmt);
      case "while":
        return yield* buildWhileStatement(stmt);
      case "for":
        return yield* buildForStatement(stmt);
      case "return":
        return yield* buildReturnStatement(stmt);
      case "break":
        return yield* buildBreakStatement(stmt);
      case "continue":
        return yield* buildContinueStatement(stmt);
      default:
        return yield* addError(
          new IrgenError(
            `Unsupported control flow: ${stmt.kind}`,
            stmt.loc ?? undefined,
            Severity.Error,
          ),
        );
    }
  };
};

/**
 * Build an if statement
 */
export const makeBuildIfStatement = (
  buildStatement: (stmt: Ast.Statement) => IrGen<void>,
) => {
  const buildBlock = makeBuildBlock(buildStatement);
  return function* buildIfStatement(
    stmt: Ast.Statement.ControlFlow,
  ): IrGen<void> {
    const thenBlock = yield* createBlock("then");
    const elseBlock = stmt.alternate
      ? yield* createBlock("else")
      : yield* createBlock("merge");
    const mergeBlock = stmt.alternate ? yield* createBlock("merge") : elseBlock; // For no-else case, elseBlock IS the merge block

    // Evaluate condition
    const condVal = yield* buildExpression(stmt.condition!);

    // Branch to then or else/merge
    yield* setTerminator({
      kind: "branch",
      condition: condVal,
      trueTarget: thenBlock,
      falseTarget: elseBlock,
    });

    // Build then block
    yield* switchToBlock(thenBlock);
    yield* buildBlock(stmt.body!);

    {
      const state = yield* peek();
      // Only set terminator if block doesn't have one
      if (!state.block.terminator) {
        yield* setTerminator({
          kind: "jump",
          target: mergeBlock,
        });
      }
    }

    // Build else block if it exists
    if (stmt.alternate) {
      yield* switchToBlock(elseBlock);
      yield* buildBlock(stmt.alternate);

      {
        const state = yield* peek();
        if (!state.block.terminator) {
          yield* setTerminator({
            kind: "jump",
            target: mergeBlock,
          });
        }
      }
    }

    // Continue in merge block
    yield* switchToBlock(mergeBlock);
  };
};

/**
 * Unified loop builder for while and for loops
 */
const makeBuildLoop = (buildStatement: (stmt: Ast.Statement) => IrGen<void>) =>
  function* buildLoop(config: {
    init?: Ast.Statement;
    condition?: Ast.Expression;
    update?: Ast.Statement;
    body: Ast.Block;
    prefix: string;
  }): IrGen<void> {
    const buildBlock = makeBuildBlock(buildStatement);

    // Execute init statement if present (for loops)
    if (config.init) {
      yield* buildStatement(config.init);
    }

    // Create blocks
    const headerBlock = yield* createBlock(`${config.prefix}_header`);
    const bodyBlock = yield* createBlock(`${config.prefix}_body`);
    const exitBlock = yield* createBlock(`${config.prefix}_exit`);

    // For 'for' loops, we need an update block
    const updateBlock = config.update
      ? yield* createBlock(`${config.prefix}_update`)
      : null;

    // Jump to header
    yield* setTerminator({
      kind: "jump",
      target: headerBlock,
    });

    // Header: evaluate condition and branch
    yield* switchToBlock(headerBlock);

    const condVal = config.condition
      ? yield* buildExpression(config.condition)
      : Ir.Value.constant(1n, { kind: "bool" }); // infinite loop if no condition

    yield* setTerminator({
      kind: "branch",
      condition: condVal,
      trueTarget: bodyBlock,
      falseTarget: exitBlock,
    });

    // Body: execute loop body
    yield* switchToBlock(bodyBlock);

    // Set up loop context (continue target depends on whether we have update)
    const continueTarget = updateBlock || headerBlock;
    yield* pushLoop(continueTarget, exitBlock);

    yield* buildBlock(config.body);

    yield* popLoop();

    // Jump to update block (for loop) or header (while loop)
    {
      const state = yield* peek();
      if (!state.block.terminator) {
        yield* setTerminator({
          kind: "jump",
          target: continueTarget,
        });
      }
    }

    // Update block (only for 'for' loops)
    if (updateBlock && config.update) {
      yield* switchToBlock(updateBlock);
      yield* buildStatement(config.update);

      const state = yield* peek();
      if (!state.block.terminator) {
        yield* setTerminator({
          kind: "jump",
          target: headerBlock,
        });
      }
    }

    // Continue from exit block
    yield* switchToBlock(exitBlock);
  };

/**
 * Build a while statement
 */
export const makeBuildWhileStatement = (
  buildStatement: (stmt: Ast.Statement) => IrGen<void>,
) => {
  const buildLoop = makeBuildLoop(buildStatement);
  return function* buildWhileStatement(
    stmt: Ast.Statement.ControlFlow,
  ): IrGen<void> {
    yield* buildLoop({
      condition: stmt.condition,
      body: stmt.body!,
      prefix: "while",
    });
  };
};

/**
 * Build a for statement
 */
export const makeBuildForStatement = (
  buildStatement: (stmt: Ast.Statement) => IrGen<void>,
) => {
  const buildLoop = makeBuildLoop(buildStatement);
  return function* buildForStatement(
    stmt: Ast.Statement.ControlFlow,
  ): IrGen<void> {
    yield* buildLoop({
      init: stmt.init,
      condition: stmt.condition,
      update: stmt.update,
      body: stmt.body!,
      prefix: "for",
    });
  };
};

/**
 * Build a return statement
 */
function* buildReturnStatement(stmt: Ast.Statement.ControlFlow): IrGen<void> {
  const value = stmt.value ? yield* buildExpression(stmt.value) : undefined;

  yield* setTerminator({
    kind: "return",
    value,
  });
}

/**
 * Build a break statement
 */
function* buildBreakStatement(stmt: Ast.Statement.ControlFlow): IrGen<void> {
  const loop = yield* getCurrentLoop();

  if (!loop) {
    yield* addError(
      new IrgenError(
        "Break outside loop",
        stmt.loc ?? undefined,
        Severity.Error,
      ),
    );

    return;
  }

  yield* setTerminator({
    kind: "jump",
    target: loop.breakTarget,
  });
}

/**
 * Build a continue statement
 */
function* buildContinueStatement(stmt: Ast.Statement.ControlFlow): IrGen<void> {
  const loop = yield* getCurrentLoop();

  if (!loop) {
    yield* addError(
      new IrgenError(
        "Continue outside loop",
        stmt.loc ?? undefined,
        Severity.Error,
      ),
    );

    return;
  }

  yield* setTerminator({
    kind: "jump",
    target: loop.continueTarget,
  });
}

/**
 * Generate a new block
 */
function* createBlock(prefix: string): IrGen<string> {
  const state = yield* peek();
  const id = `${prefix}_${state.counters.block}`;
  // Just generate the ID and update counter
  // The actual block will be created when we switch to it
  yield* updateCounters((c) => ({ ...c, block: c.block + 1 }));
  return id;
}

/**
 * Switch to a block
 */
function* switchToBlock(blockId: string): IrGen<void> {
  // First sync current block to function if it's complete
  yield* syncBlockToFunction();

  const state = yield* peek();
  const existingBlock = state.function.blocks.get(blockId);

  if (existingBlock) {
    // Switch to existing block
    yield* updateBlock(() => ({
      id: existingBlock.id,
      instructions: [...existingBlock.instructions],
      terminator: existingBlock.terminator,
      predecessors: new Set(existingBlock.predecessors),
      phis: [...existingBlock.phis],
    }));
  } else {
    // Create new block context
    yield* updateBlock(() => ({
      id: blockId,
      instructions: [],
      terminator: undefined,
      predecessors: new Set(),
      phis: [],
    }));
  }
}
