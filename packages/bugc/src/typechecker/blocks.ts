import * as Ast from "#ast";
import { Type } from "#types";
import type { Visitor } from "#ast";
import type { Symbol } from "./symbols.js";
import type { Context, Report } from "./context.js";
import { enterFunctionScope } from "./symbols.js";
import { Error as TypeError, ErrorCode, ErrorMessages } from "./errors.js";
import { resolveType } from "./declarations.js";
import { isAssignable } from "./assignable.js";

/**
 * Type checker for block-level constructs:
 * - program
 * - blocks
 * - declarations
 */
export const blockChecker: Pick<
  Visitor<Report, Context>,
  "program" | "block" | "declaration"
> = {
  program(node: Ast.Program, context: Context): Report {
    // Note: First two passes (collecting structs/functions and storage)
    // are already done in collectDeclarations() and buildInitialSymbols()
    // We only need to handle the third pass and main body processing

    let currentSymbols = context.symbols;
    let currentNodeTypes = context.nodeTypes;
    const allErrors: TypeError[] = [];

    // Visit all declarations to ensure they get types in nodeTypes map
    for (const decl of node.declarations) {
      // Visit storage and function declarations to set their types in nodeTypes
      if (decl.kind === "storage" || decl.kind === "function") {
        const declContext: Context = {
          ...context,
          symbols: currentSymbols,
          nodeTypes: currentNodeTypes,
          pointer:
            context.pointer +
            "/declarations/" +
            node.declarations.indexOf(decl),
          visitor: context.visitor,
        };
        const declResult = Ast.visit(declContext.visitor, decl, declContext);
        currentNodeTypes = declResult.nodeTypes;
        allErrors.push(...declResult.errors);
      }
    }

    // Third pass: type check function bodies
    for (const decl of node.declarations) {
      if (Ast.Declaration.isFunction(decl)) {
        // Look up the function type
        const funcType = currentSymbols.lookup(decl.name)
          ?.type as Type.Function;
        if (funcType) {
          // Create a new scope with function parameters
          const funcSymbols = enterFunctionScope(
            currentSymbols,
            decl,
            funcType,
          );

          // Create context for function body with return type set
          const funcContext: Context = {
            ...context,
            symbols: funcSymbols,
            currentReturnType: funcType.returnType || undefined,
            nodeTypes: currentNodeTypes,
            pointer:
              context.pointer +
              "/declarations/" +
              node.declarations.indexOf(decl),
            visitor: context.visitor,
          };

          // Type check the function body
          const bodyResult = Ast.visit(
            funcContext.visitor,
            decl.body,
            funcContext,
          );

          // Exit function scope - we don't propagate function-local symbols
          // so we keep currentSymbols unchanged (it still points to the pre-function scope)
          currentNodeTypes = bodyResult.nodeTypes;
          allErrors.push(...bodyResult.errors);
        }
      }
    }

    // Process create block if present
    if (node.create) {
      const createContext: Context = {
        ...context,
        symbols: currentSymbols,
        nodeTypes: currentNodeTypes,
        pointer: context.pointer + "/create",
      };
      const createResult = Ast.visit(
        createContext.visitor,
        node.create,
        createContext,
      );
      currentSymbols = createResult.symbols;
      currentNodeTypes = createResult.nodeTypes;
      allErrors.push(...createResult.errors);
    }

    // Process main code block
    const bodyContext: Context = {
      ...context,
      symbols: currentSymbols,
      nodeTypes: currentNodeTypes,
      pointer: context.pointer + "/body",
    };
    const bodyResult = node.body
      ? Ast.visit(bodyContext.visitor, node.body, bodyContext)
      : undefined;

    return {
      symbols: bodyResult?.symbols || currentSymbols,
      nodeTypes: bodyResult?.nodeTypes || currentNodeTypes,
      errors: bodyResult ? [...allErrors, ...bodyResult.errors] : allErrors,
    };
  },

  block(node: Ast.Block, context: Context): Report {
    // Only statement blocks need scope management
    // (program and statements kinds, not create kind)
    if (node.kind === "program" || node.kind === "statements") {
      // Enter new scope
      let currentSymbols = context.symbols.enterScope();
      let currentNodeTypes = context.nodeTypes;
      const allErrors: TypeError[] = [];

      // Process each item in the block
      for (let i = 0; i < node.items.length; i++) {
        const item = node.items[i];
        const itemContext: Context = {
          ...context,
          symbols: currentSymbols,
          nodeTypes: currentNodeTypes,
          pointer: context.pointer + "/" + i,
        };

        const itemResult = Ast.visit(itemContext.visitor, item, itemContext);

        // Thread the results to the next item
        currentSymbols = itemResult.symbols;
        currentNodeTypes = itemResult.nodeTypes;
        allErrors.push(...itemResult.errors);
      }

      // Exit scope
      return {
        symbols: currentSymbols.exitScope(),
        nodeTypes: currentNodeTypes,
        errors: allErrors,
      };
    }

    // For other block kinds (like "create"), just return unchanged
    return {
      symbols: context.symbols,
      nodeTypes: context.nodeTypes,
      errors: [],
    };
  },

  declaration(node: Ast.Declaration, context: Context): Report {
    const errors: TypeError[] = [];
    let nodeTypes = new Map(context.nodeTypes);
    let symbols = context.symbols;

    switch (node.kind) {
      case "struct":
        // Already processed in collectDeclarations phase
        return { symbols, nodeTypes, errors };

      case "function": {
        // Function declarations are already in the symbol table from buildInitialSymbols
        // We just need to set the type on the node
        const symbol = symbols.lookup(node.name);
        if (symbol) {
          nodeTypes.set(node.id, symbol.type);
        }
        return { type: symbol?.type, symbols, nodeTypes, errors };
      }

      case "storage": {
        // Storage declarations are already in the symbol table from buildInitialSymbols
        // We just need to set the type on the node
        const symbol = symbols.lookup(node.name);
        if (symbol) {
          nodeTypes.set(node.id, symbol.type);
        }
        return { type: symbol?.type, symbols, nodeTypes, errors };
      }

      case "variable": {
        if (!node.initializer) {
          const error = new TypeError(
            `Variable ${node.name} must have an initializer`,
            node.loc || undefined,
            undefined,
            undefined,
            ErrorCode.MISSING_INITIALIZER,
          );
          errors.push(error);

          // Still define the variable with error type
          const errorType = new Type.Failure("missing initializer");
          const symbol: Symbol = {
            name: node.name,
            type: errorType,
            mutable: true,
            location: "memory",
          };
          symbols = symbols.define(symbol);
          nodeTypes.set(node.id, errorType);
          return { type: errorType, symbols, nodeTypes, errors };
        }

        // Type check the initializer
        const initContext: Context = {
          ...context,
          nodeTypes,
          pointer: context.pointer + "/initializer",
        };
        const initResult = Ast.visit(
          initContext.visitor,
          node.initializer,
          initContext,
        );
        nodeTypes = initResult.nodeTypes;
        errors.push(...initResult.errors);

        // Determine the variable's type
        let type: Type;
        if (node.declaredType) {
          // If a type is explicitly declared, use it
          type = resolveType(node.declaredType, context.structs);

          // Check that the initializer is compatible with the declared type
          if (initResult.type && !isAssignable(type, initResult.type)) {
            const error = new TypeError(
              ErrorMessages.TYPE_MISMATCH(
                type.toString(),
                initResult.type.toString(),
              ),
              node.initializer.loc || undefined,
              type.toString(),
              initResult.type.toString(),
              ErrorCode.TYPE_MISMATCH,
            );
            errors.push(error);
          }
        } else {
          // Otherwise, infer the type from the initializer
          type = initResult.type || new Type.Failure("invalid initializer");
        }

        const symbol: Symbol = {
          name: node.name,
          type,
          mutable: true,
          location: "memory",
        };
        symbols = symbols.define(symbol);
        nodeTypes.set(node.id, type);
        return { type, symbols, nodeTypes, errors };
      }

      case "field":
        // Fields are handled as part of struct processing
        return { symbols, nodeTypes, errors };

      default:
        return { symbols, nodeTypes, errors };
    }
  },
};
