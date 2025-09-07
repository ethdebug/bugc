/**
 * Symbol table for tracking variables and their types
 */

import type { Type } from "./definitions.js";

// Symbol table entry
export interface BugSymbol {
  name: string;
  type: Type;
  mutable: boolean;
  location: "storage" | "memory" | "builtin";
  slot?: number; // For storage variables
}

// Symbol table with scoping
export class SymbolTable {
  private scopes: Map<string, BugSymbol>[] = [new Map()];

  enterScope(): void {
    this.scopes.push(new Map());
  }

  exitScope(): void {
    if (this.scopes.length > 1) {
      this.scopes.pop();
    }
  }

  define(symbol: BugSymbol): void {
    const currentScope = this.scopes[this.scopes.length - 1];
    currentScope.set(symbol.name, symbol);
  }

  lookup(name: string): BugSymbol | undefined {
    // Search from innermost to outermost scope
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const symbol = this.scopes[i].get(name);
      if (symbol) {
        return symbol;
      }
    }
    return undefined;
  }

  isDefined(name: string): boolean {
    return this.lookup(name) !== undefined;
  }

  isDefinedInCurrentScope(name: string): boolean {
    const currentScope = this.scopes[this.scopes.length - 1];
    return currentScope.has(name);
  }
}
