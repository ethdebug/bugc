import type * as Ast from "#ast";
import * as Ir from "#ir";

import { assertExhausted } from "#irgen/errors";

import { State, type Modify, type Read, isModify, isRead } from "./state.js";

/**
 * Generator type for IR operations
 * - Yields IrOperation commands
 * - Returns final value of type T
 * - Receives State back after peek operations
 */
export type Process<T> = Generator<Process.Action, T, State>;

export namespace Process {
  /**
   * Operation types that can be yielded from generators
   */
  export type Action =
    | { type: "modify"; fn: (state: State) => State }
    | { type: "peek" }
    | { type: "value"; value: unknown };

  export namespace Types {
    export const nodeType = lift(State.Types.nodeType);
  }

  export namespace Instructions {
    /**
     * Emit an instruction to the current block
     */
    export const emit = lift(State.Block.emit);
  }

  /**
   * Block operations for managing basic blocks in the IR
   */
  export namespace Blocks {
    /**
     * Set the terminator for the current block and update predecessors
     */
    export function* terminate(terminator: Ir.Block.Terminator): Process<void> {
      yield* lift(State.Block.setTerminator)(terminator);

      // Track predecessors for target blocks
      const state: State = yield { type: "peek" };
      const currentBlockId = state.block.id;

      switch (terminator.kind) {
        case "jump":
          yield* addPredecessorToBlock(terminator.target, currentBlockId);
          break;
        case "branch":
          yield* addPredecessorToBlock(terminator.trueTarget, currentBlockId);
          yield* addPredecessorToBlock(terminator.falseTarget, currentBlockId);
          break;
        case "call":
          yield* addPredecessorToBlock(terminator.continuation, currentBlockId);
          break;
      }
    }

    /**
     * Add a predecessor to a block (creating it if needed)
     */
    const addPredecessorToBlock = function* (
      targetBlockId: string,
      predId: string,
    ): Process<void> {
      const state: State = yield { type: "peek" };
      const existingBlock = state.function.blocks.get(targetBlockId);

      if (existingBlock) {
        // Update existing block with new predecessor
        const updatedBlock: Ir.Block = {
          ...existingBlock,
          predecessors: new Set([...existingBlock.predecessors, predId]),
        };

        // Update function with the updated block
        yield {
          type: "modify",
          fn: (s: State) => ({
            ...s,
            function: {
              ...s.function,
              blocks: new Map([
                ...s.function.blocks,
                [targetBlockId, updatedBlock],
              ]),
            },
          }),
        };
      } else {
        // Create placeholder block with predecessor
        const placeholderBlock: Ir.Block = {
          id: targetBlockId,
          instructions: [],
          terminator: { kind: "jump", target: targetBlockId }, // Placeholder terminator
          predecessors: new Set([predId]),
          phis: [],
        };

        // Add the new block to the function
        yield {
          type: "modify",
          fn: (s: State) => ({
            ...s,
            function: {
              ...s.function,
              blocks: new Map([
                ...s.function.blocks,
                [targetBlockId, placeholderBlock],
              ]),
            },
          }),
        };
      }
    };

    export const currentTerminator = lift(State.Block.terminator);

    /**
     * Create a new block with a generated ID
     */
    export function* create(prefix: string): Process<string> {
      const state: State = yield { type: "peek" };
      const id = `${prefix}_${state.counters.block}`;
      yield* lift(State.Counters.consumeBlock)();
      return id;
    }

    /**
     * Switch to a different block, syncing the current block to the function
     */
    export function* switchTo(blockId: string): Process<void> {
      // First sync current block to function
      yield* syncCurrent();

      // Check if block already exists
      const state: State = yield { type: "peek" };
      const existingBlock = state.function.blocks.get(blockId);

      if (existingBlock) {
        // Switch to existing block, preserving its contents
        // Check if it has a placeholder terminator (self-jump)
        const isPlaceholder =
          existingBlock.terminator &&
          existingBlock.terminator.kind === "jump" &&
          existingBlock.terminator.target === blockId;

        yield {
          type: "modify",
          fn: (state: State) => ({
            ...state,
            block: {
              id: existingBlock.id,
              instructions: [...existingBlock.instructions],
              terminator: isPlaceholder ? undefined : existingBlock.terminator,
              predecessors: new Set(existingBlock.predecessors),
              phis: [...existingBlock.phis],
            },
          }),
        };
      } else {
        // Create new empty block
        const newBlock: State.Block = {
          id: blockId,
          instructions: [],
          terminator: undefined,
          predecessors: new Set(),
          phis: [],
        };

        yield {
          type: "modify",
          fn: (state: State) => ({
            ...state,
            block: newBlock,
          }),
        };
      }
    }

    /**
     * Sync current block to the function
     */
    export function* syncCurrent(): Process<void> {
      const state: State = yield { type: "peek" };
      const block = state.block;

      // Only sync if block has a terminator
      if (block.terminator) {
        const completeBlock: Ir.Block = {
          id: block.id,
          instructions: block.instructions,
          terminator: block.terminator,
          predecessors: block.predecessors,
          phis: block.phis,
        };

        yield* lift(State.Function.addBlock)(block.id, completeBlock);
      }
    }
  }

  /**
   * Variable and scope management
   */
  export namespace Variables {
    /**
     * Declare a new SSA variable in the current scope
     */
    export function* declare(
      name: string,
      type: Ir.Type,
    ): Process<State.SsaVariable> {
      const scope = yield* lift(State.Scopes.current)();
      const tempId = yield* newTemp();

      const version = (scope.ssaVars.get(name)?.version ?? -1) + 1;
      const ssaVar: State.SsaVariable = {
        name,
        currentTempId: tempId,
        type,
        version,
      };

      // Update scope with new SSA variable
      const newScope = {
        ...scope,
        ssaVars: new Map([...scope.ssaVars, [name, ssaVar]]),
        usedNames: new Map([...scope.usedNames, [name, version + 1]]),
      };

      // Update scopes
      yield* lift(State.Scopes.setCurrent)(newScope);

      // Track SSA metadata for phi insertion
      const scopeIndex = yield* lift(State.Scopes.extract)(
        (s) => s.stack.length - 1,
      );
      const scopeId = `scope_${scopeIndex}_${name}`;
      yield* addSsaMetadata(tempId, name, scopeId, type, version);

      return ssaVar;
    }

    /**
     * Declare a new SSA variable with an existing temp ID
     */
    export function* declareWithExistingTemp(
      name: string,
      type: Ir.Type,
      tempId: string,
    ): Process<State.SsaVariable> {
      const scope = yield* lift(State.Scopes.current)();

      const version = (scope.ssaVars.get(name)?.version ?? -1) + 1;
      const ssaVar: State.SsaVariable = {
        name,
        currentTempId: tempId,
        type,
        version,
      };

      // Update scope with new SSA variable
      const newScope = {
        ...scope,
        ssaVars: new Map([...scope.ssaVars, [name, ssaVar]]),
        usedNames: new Map([...scope.usedNames, [name, version + 1]]),
      };

      // Update scopes
      yield* lift(State.Scopes.setCurrent)(newScope);

      // Track SSA metadata for the existing temp
      const scopeIndex = yield* lift(State.Scopes.extract)(
        (s) => s.stack.length - 1,
      );
      const scopeId = `scope_${scopeIndex}_${name}`;
      yield* addSsaMetadata(tempId, name, scopeId, type, version);

      return ssaVar;
    }

    /**
     * Create a new SSA version for a variable (for assignments)
     */
    export function* assignSsa(
      name: string,
      type: Ir.Type,
    ): Process<State.SsaVariable> {
      const tempId = yield* newTemp();

      // Find the current scope that has this variable
      const scopes = yield* lift(State.Scopes.extract)((s) => s.stack);
      let scopeIndex = -1;

      for (let i = scopes.length - 1; i >= 0; i--) {
        if (scopes[i].ssaVars.has(name)) {
          scopeIndex = i;
          break;
        }
      }

      if (scopeIndex === -1) {
        // Variable doesn't exist, create it in current scope
        return yield* declare(name, type);
      }

      const targetScope = scopes[scopeIndex];
      const currentVar = targetScope.ssaVars.get(name)!;
      const newVersion = currentVar.version + 1;

      const ssaVar: State.SsaVariable = {
        name,
        currentTempId: tempId,
        type,
        version: newVersion,
      };

      // Update the target scope
      const updatedScope = {
        ...targetScope,
        ssaVars: new Map([...targetScope.ssaVars, [name, ssaVar]]),
      };

      // Rebuild the scope stack
      const newStack = [
        ...scopes.slice(0, scopeIndex),
        updatedScope,
        ...scopes.slice(scopeIndex + 1),
      ];

      yield* lift(State.Scopes.update)(() => ({ stack: newStack }));

      // Track SSA metadata for phi insertion
      const scopeId = `scope_${scopeIndex}_${name}`;
      yield* addSsaMetadata(tempId, name, scopeId, type, newVersion);

      return ssaVar;
    }

    /**
     * Add SSA metadata for a temp ID
     */
    const addSsaMetadata = function* (
      tempId: string,
      name: string,
      scopeId: string,
      type: Ir.Type,
      version: number,
    ): Process<void> {
      const state: State = yield { type: "peek" };
      const currentMetadata = state.function.ssaMetadata || new Map();

      const newMetadata = new Map(currentMetadata);
      newMetadata.set(tempId, {
        name,
        scopeId,
        type,
        version,
      });

      // Update function with new metadata
      yield {
        type: "modify",
        fn: (s: State) => ({
          ...s,
          function: {
            ...s.function,
            ssaMetadata: newMetadata,
          },
        }),
      };
    };

    /**
     * Look up a variable by name in the scope chain
     */
    export const lookup = lift(State.Scopes.lookupVariable);

    /**
     * Check if we need a phi node for this variable and insert if needed
     */
    export function* checkAndInsertPhi(
      varName: string,
      ssaVar: State.SsaVariable,
    ): Process<string | null> {
      const state: State = yield { type: "peek" };
      const currentBlock = state.block;

      // Only consider phi nodes if we have multiple predecessors
      if (currentBlock.predecessors.size <= 1) {
        return null;
      }

      // Check if we already have a phi node for this variable
      const existingPhi = currentBlock.phis.find((phi) => {
        // Check if this phi is for the same logical variable
        const metadata = state.function.ssaMetadata?.get(phi.dest);
        return metadata && metadata.name === varName;
      });

      if (existingPhi) {
        return existingPhi.dest;
      }

      // Check if different predecessors have different temps for this variable
      const predTemps = new Map<string, string>();
      let needsPhi = false;
      let firstTemp: string | null = null;

      // We need to look at the SSA metadata to find which temps each predecessor uses
      for (const predId of currentBlock.predecessors) {
        // Look up what temp this predecessor uses for this variable
        const predBlock = state.function.blocks.get(predId);
        if (!predBlock) continue;

        // Find the last assignment to this variable in the predecessor
        let lastTemp: string | null = null;

        // Check all temps in our metadata to find ones that match this variable
        // and were defined in this predecessor block
        if (state.function.ssaMetadata) {
          for (const [tempId, metadata] of state.function.ssaMetadata) {
            if (metadata.name === varName) {
              // Check if this temp is defined in the predecessor block
              for (const inst of predBlock.instructions) {
                if ("dest" in inst && inst.dest === tempId) {
                  lastTemp = tempId;
                  // Keep looking for later assignments
                }
              }
            }
          }
        }

        // If no assignment in block, use the value from the predecessor's entry
        // (this would be the value that flows through the block)
        if (!lastTemp && varName === ssaVar.name) {
          // Use the current SSA temp as it flows through
          lastTemp = ssaVar.currentTempId;
        }

        if (lastTemp) {
          predTemps.set(predId, lastTemp);
          if (firstTemp === null) {
            firstTemp = lastTemp;
          } else if (firstTemp !== lastTemp) {
            needsPhi = true;
          }
        }
      }

      // If all predecessors use the same temp (or variable isn't defined), no phi needed
      if (!needsPhi || predTemps.size === 0) {
        return null;
      }

      // Create a new temp for the phi destination
      const phiDest = yield* newTemp();

      // Build phi sources map
      const sources = new Map<string, Ir.Value>();
      for (const [predId, tempId] of predTemps) {
        const metadata = state.function.ssaMetadata?.get(tempId);
        sources.set(
          predId,
          Ir.Value.temp(tempId, metadata?.type || ssaVar.type),
        );
      }

      // Add phi node to the block
      const phi: Ir.Block.Phi = {
        kind: "phi",
        dest: phiDest,
        sources,
        type: ssaVar.type,
      };

      yield* lift(State.Block.addPhi)(phi);

      // Track SSA metadata for the new phi temp
      const scopeIndex = yield* lift(State.Scopes.extract)(
        (s) => s.stack.length - 1,
      );
      const scopeId = `scope_${scopeIndex}_${varName}`;
      yield* addSsaMetadata(
        phiDest,
        varName,
        scopeId,
        ssaVar.type,
        ssaVar.version + 1,
      );

      // Update the SSA variable to use the phi result
      yield* updateSsaTemp(varName, phiDest);

      return phiDest;
    }

    /**
     * Update the current temp for an SSA variable
     */
    const updateSsaTemp = function* (
      name: string,
      newTempId: string,
    ): Process<void> {
      const scopes = yield* lift(State.Scopes.extract)((s) => s.stack);
      let scopeIndex = -1;

      // Find which scope has this variable
      for (let i = scopes.length - 1; i >= 0; i--) {
        if (scopes[i].ssaVars.has(name)) {
          scopeIndex = i;
          break;
        }
      }

      if (scopeIndex === -1) return;

      const targetScope = scopes[scopeIndex];
      const currentVar = targetScope.ssaVars.get(name)!;

      // Update with new temp
      const updatedVar: State.SsaVariable = {
        ...currentVar,
        currentTempId: newTempId,
      };

      const updatedScope = {
        ...targetScope,
        ssaVars: new Map([...targetScope.ssaVars, [name, updatedVar]]),
      };

      // Rebuild the scope stack
      const newStack = [
        ...scopes.slice(0, scopeIndex),
        updatedScope,
        ...scopes.slice(scopeIndex + 1),
      ];

      yield* lift(State.Scopes.update)(() => ({ stack: newStack }));
    };

    /**
     * Update an SSA variable to point to an existing temp without creating a new one
     */
    export function* updateSsaToExistingTemp(
      name: string,
      existingTempId: string,
      type: Ir.Type,
    ): Process<void> {
      const scopes = yield* lift(State.Scopes.extract)((s) => s.stack);
      let scopeIndex = -1;

      // Find which scope has this variable
      for (let i = scopes.length - 1; i >= 0; i--) {
        if (scopes[i].ssaVars.has(name)) {
          scopeIndex = i;
          break;
        }
      }

      if (scopeIndex === -1) {
        // Variable doesn't exist, create it in current scope
        // But use the existing temp instead of creating a new one
        const scope = yield* lift(State.Scopes.current)();
        const version = (scope.ssaVars.get(name)?.version ?? -1) + 1;

        const ssaVar: State.SsaVariable = {
          name,
          currentTempId: existingTempId,
          type,
          version,
        };

        // Update scope with new SSA variable
        const newScope = {
          ...scope,
          ssaVars: new Map([...scope.ssaVars, [name, ssaVar]]),
          usedNames: new Map([...scope.usedNames, [name, version + 1]]),
        };

        yield* lift(State.Scopes.setCurrent)(newScope);

        // Track SSA metadata for the existing temp
        const scopeId = `scope_${scopeIndex === -1 ? 0 : scopeIndex}_${name}`;
        yield* addSsaMetadata(existingTempId, name, scopeId, type, version);
        return;
      }

      const targetScope = scopes[scopeIndex];
      const currentVar = targetScope.ssaVars.get(name)!;
      const newVersion = currentVar.version + 1;

      // Update with the existing temp instead of creating a new one
      const updatedVar: State.SsaVariable = {
        name,
        currentTempId: existingTempId,
        type,
        version: newVersion,
      };

      const updatedScope = {
        ...targetScope,
        ssaVars: new Map([...targetScope.ssaVars, [name, updatedVar]]),
      };

      // Rebuild the scope stack
      const newStack = [
        ...scopes.slice(0, scopeIndex),
        updatedScope,
        ...scopes.slice(scopeIndex + 1),
      ];

      yield* lift(State.Scopes.update)(() => ({ stack: newStack }));

      // Track SSA metadata for the existing temp
      const scopeId = `scope_${scopeIndex}_${name}`;
      yield* addSsaMetadata(existingTempId, name, scopeId, type, newVersion);
    }

    /**
     * Generate a new temporary variable ID
     */
    export function* newTemp(): Process<string> {
      const temp = yield* lift(State.Counters.nextTemp)();
      const id = `t${temp}`;
      yield* lift(State.Counters.consumeTemp)();
      return id;
    }

    /**
     * Enter a new scope
     */
    export const enterScope = lift(State.Scopes.push);

    /**
     * Exit the current scope
     */
    export const exitScope = lift(State.Scopes.pop);

    /**
     * Capture current state of all variables for loop phi insertion
     */
    export function* captureCurrentVariables(): Process<
      Map<string, { tempId: string; type: Ir.Type }>
    > {
      const scopes = yield* lift(State.Scopes.extract)((s) => s.stack);
      const result = new Map<string, { tempId: string; type: Ir.Type }>();

      // Capture all variables from all scopes
      for (const scope of scopes) {
        for (const [name, ssaVar] of scope.ssaVars) {
          // Only capture the innermost definition of each variable
          if (!result.has(name)) {
            result.set(name, {
              tempId: ssaVar.currentTempId,
              type: ssaVar.type,
            });
          }
        }
      }

      return result;
    }

    /**
     * Create phi nodes for loop variables at loop header
     */
    export function createLoopPhis(
      preLoopVars: Map<string, { tempId: string; type: Ir.Type }>,
      _headerBlockId: string,
    ): Map<
      string,
      { phiTemp: string; varName: string; type: Ir.Type; initialTemp: string }
    > {
      const loopPhis = new Map<
        string,
        { phiTemp: string; varName: string; type: Ir.Type; initialTemp: string }
      >();

      // Track which variables exist before the loop
      for (const [varName, { tempId, type }] of preLoopVars) {
        // We'll track this for creating phi nodes later
        loopPhis.set(varName, {
          phiTemp: "", // Will be set when we create the actual phi
          varName,
          type,
          initialTemp: tempId, // The temp value before entering the loop
        });
      }

      return loopPhis;
    }

    /**
     * Update loop phi nodes with values from the loop body
     */
    export function* updateLoopPhis(
      loopPhis: Map<
        string,
        { phiTemp: string; varName: string; type: Ir.Type; initialTemp: string }
      >,
      fromBlockId: string,
      headerBlockId: string,
    ): Process<void> {
      const state: State = yield { type: "peek" };
      const headerBlock = state.function.blocks.get(headerBlockId);
      if (!headerBlock) return;

      // Get current values of all loop variables
      const currentVars = yield* captureCurrentVariables();

      for (const [varName, loopPhi] of loopPhis) {
        const currentVar = currentVars.get(varName);
        if (!currentVar) continue;

        // Check if the variable was modified in the loop
        if (currentVar.tempId !== loopPhi.initialTemp) {
          // Variable was modified, we need a phi node
          const phiTemp = yield* newTemp();

          // Find the entry predecessor (the block before the loop)
          const entryPredecessor = Array.from(headerBlock.predecessors).find(
            (pred) => !pred.includes("body") && !pred.includes("update"),
          );

          if (entryPredecessor) {
            // Build the phi sources
            const sources = new Map<string, Ir.Value>();

            // Entry value (from before the loop)
            sources.set(
              entryPredecessor,
              Ir.Value.temp(loopPhi.initialTemp, loopPhi.type),
            );

            // Loop body/update value
            sources.set(
              fromBlockId,
              Ir.Value.temp(currentVar.tempId, loopPhi.type),
            );

            // Add phi node to header block
            const phi: Ir.Block.Phi = {
              kind: "phi",
              dest: phiTemp,
              sources,
              type: loopPhi.type,
            };

            // Add the phi to the header block
            yield {
              type: "modify",
              fn: (s: State) => {
                const updatedBlock = s.function.blocks.get(headerBlockId);
                if (!updatedBlock) return s;

                return {
                  ...s,
                  function: {
                    ...s.function,
                    blocks: new Map([
                      ...s.function.blocks,
                      [
                        headerBlockId,
                        {
                          ...updatedBlock,
                          phis: [...updatedBlock.phis, phi],
                        },
                      ],
                    ]),
                  },
                };
              },
            };

            // Track SSA metadata for the phi
            const scopeIndex = yield* lift(State.Scopes.extract)(
              (s) => s.stack.length - 1,
            );
            const scopeId = `scope_${scopeIndex}_${varName}`;
            yield* addSsaMetadata(phiTemp, varName, scopeId, loopPhi.type, 0);

            // Update the SSA variable to use the phi result in the header block
            // This ensures uses of the variable in the loop see the phi result
            yield* updateSsaTemp(varName, phiTemp);
          }
        }
      }
    }
  }

  /**
   * Control flow context management
   */
  export namespace ControlFlow {
    /**
     * Enter a loop context
     */
    export const enterLoop = lift(State.Loops.push);

    /**
     * Exit the current loop context
     */
    export const exitLoop = lift(State.Loops.pop);

    /**
     * Get the current loop context
     */
    export function* currentLoop(): Process<State.Loop | null> {
      const state: State = yield { type: "peek" };
      const loop = state.loops.stack[state.loops.stack.length - 1];
      return loop || null;
    }
  }

  /**
   * Function building operations
   */
  export namespace Functions {
    /**
     * Initialize a new function context
     */
    export function* initialize(
      name: string,
      parameters: { name: string; type: Ir.Type }[],
    ): Process<void> {
      // Convert parameters to SSA form
      const ssaParams: Ir.Function.Parameter[] = [];
      const paramSsaVars = new Map<string, State.SsaVariable>();
      const ssaMetadata = new Map<string, Ir.Function.SsaVariable>();

      for (const param of parameters) {
        const tempId = `t${ssaParams.length}`;
        const ssaParam: Ir.Function.Parameter = {
          name: param.name,
          type: param.type,
          tempId,
        };
        ssaParams.push(ssaParam);

        // Track SSA variable for the parameter
        paramSsaVars.set(param.name, {
          name: param.name,
          currentTempId: tempId,
          type: param.type,
          version: 0,
        });

        // Track SSA metadata for phi insertion
        ssaMetadata.set(tempId, {
          name: param.name,
          scopeId: "param",
          type: param.type,
          version: 0,
        });
      }

      // Create function context
      const functionContext: State.Function = {
        id: name,
        parameters: ssaParams,
        blocks: new Map(),
        ssaMetadata,
      };

      // Create initial block context
      const blockContext: State.Block = {
        id: "entry",
        instructions: [],
        terminator: undefined,
        predecessors: new Set(),
        phis: [],
      };

      // Update state with new contexts
      yield {
        type: "modify",
        fn: (state: State) => ({
          ...state,
          function: functionContext,
          block: blockContext,
          scopes: { stack: [{ ssaVars: paramSsaVars, usedNames: new Map() }] },
          loops: { stack: [] },
          counters: { ...state.counters, block: 1, temp: parameters.length },
        }),
      };
    }

    /**
     * Get the current function's blocks
     */
    export function* currentBlocks(): Process<Map<string, Ir.Block>> {
      const state: State = yield { type: "peek" };
      return state.function.blocks;
    }

    /**
     * Get the current function's parameters
     */
    export function* currentParameters(): Process<Ir.Function.Parameter[]> {
      const state: State = yield { type: "peek" };
      return state.function.parameters;
    }

    /**
     * Finalize the current function
     */
    export function* finalize(): Process<Ir.Function> {
      // Sync final block
      yield* Blocks.syncCurrent();

      const state: State = yield { type: "peek" };
      const func = state.function;

      return {
        name: func.id,
        parameters: func.parameters,
        entry: "entry",
        blocks: func.blocks,
      };
    }

    /**
     * Collect SSA variable metadata for phi insertion
     */
    export function* collectSsaMetadata(): Process<
      Map<string, Ir.Function.SsaVariable>
    > {
      const state: State = yield { type: "peek" };
      // Return the SSA metadata that we've been tracking in the function state
      return state.function.ssaMetadata || new Map();
    }

    /**
     * Add a function to the module
     */
    export const addToModule = lift(State.Module.addFunction);
  }

  export namespace Modules {
    export function* current(): Process<State.Module> {
      const state: State = yield { type: "peek" };
      return state.module;
    }
  }

  /**
   * Storage operations
   */
  export namespace Storage {
    /**
     * Find a storage slot by name
     */
    export function* findSlot(name: string): Process<{
      slot: number;
      name: string;
      declaration: Ast.Declaration.Storage;
    } | null> {
      const state: State = yield { type: "peek" };
      const storageDecl = state.module.storageDeclarations.find(
        (decl) => decl.name === name,
      );

      if (!storageDecl) return null;

      return {
        slot: storageDecl.slot,
        name: storageDecl.name,
        declaration: storageDecl,
      };
    }

    /**
     * Emit a compute_slot instruction
     */
    export function* computeSlot(
      baseSlot: Ir.Value,
      key: Ir.Value,
      loc?: Ast.SourceLocation,
    ): Process<Ir.Value> {
      const tempId = yield* Variables.newTemp();
      yield* Process.Instructions.emit({
        kind: "compute_slot",
        slotKind: "mapping",
        base: baseSlot,
        key,
        dest: tempId,
        loc,
      } as Ir.Instruction.ComputeSlot);
      return Ir.Value.temp(tempId, Ir.Type.Scalar.uint256);
    }

    /**
     * Emit a load_storage instruction
     */
    export function* load(
      slot: Ir.Value,
      type: Ir.Type,
      loc?: Ast.SourceLocation,
    ): Process<Ir.Value> {
      const tempId = yield* Variables.newTemp();
      yield* Process.Instructions.emit({
        kind: "read",
        location: "storage",
        slot,
        offset: Ir.Value.constant(0n, Ir.Type.Scalar.uint256),
        length: Ir.Value.constant(32n, Ir.Type.Scalar.uint256),
        type,
        dest: tempId,
        loc,
      } as Ir.Instruction.Read);
      return Ir.Value.temp(tempId, type);
    }

    /**
     * Emit a write instruction for storage
     */
    export function* store(
      slot: Ir.Value,
      value: Ir.Value,
      loc?: Ast.SourceLocation,
    ): Process<void> {
      yield* Process.Instructions.emit({
        kind: "write",
        location: "storage",
        slot,
        offset: Ir.Value.constant(0n, Ir.Type.Scalar.uint256),
        length: Ir.Value.constant(32n, Ir.Type.Scalar.uint256),
        value,
        loc,
      } as Ir.Instruction.Write);
    }
  }

  /**
   * Error handling
   */
  export namespace Errors {
    /**
     * Report an error
     */
    export const report = lift(State.Errors.append);

    export const count = lift(State.Errors.count);

    /**
     * Report a warning
     */
    export const warning = lift(State.Warnings.append);

    /**
     * Attempt an operation, catching IrgenErrors
     */
    export const attempt = lift(State.Errors.attempt);
  }

  /**
   * Run a process with an initial state
   */
  export function run<T>(
    process: Process<T>,
    initialState: State,
  ): { state: State; value: T } {
    let state = initialState;
    let next = process.next();

    while (!next.done) {
      const action = next.value;

      switch (action.type) {
        case "modify": {
          state = action.fn(state);
          next = process.next(state);
          break;
        }
        case "peek": {
          next = process.next(state);
          break;
        }
        case "value": {
          // This is for returning values without state changes
          next = process.next(state);
          break;
        }
        default:
          assertExhausted(action);
      }
    }

    return { state, value: next.value };
  }
}

// Overloaded signatures for different return types
function lift<A extends readonly unknown[]>(
  fn: (...args: A) => Modify<State>,
): (...args: A) => Process<void>;

function lift<T, A extends readonly unknown[]>(
  fn: (...args: A) => Read<State, T>,
): (...args: A) => Process<T>;

// Implementation
function lift<T, A extends readonly unknown[]>(
  fn: (...args: A) => Modify<State> | Read<State, T>,
) {
  return function* (...args: A): Process<T | void> {
    const result = fn(...args);

    if (isModify<State>(result)) {
      yield {
        type: "modify",
        fn: result,
      };
      return;
    }

    if (isRead<State, T>(result)) {
      return result(yield { type: "peek" });
    }

    assertExhausted(result);
  };
}
