import type * as Ast from "#ast";

import { Type } from "./type.js";
import { Block } from "./block.js";

/**
 * Ir function containing basic blocks
 */
export interface Function {
  /** Function name (for debugging) */
  name: string;
  /** Local variables (parameters first, then local vars) */
  locals: Function.LocalVariable[];
  /** Number of parameters (first N locals are parameters) */
  paramCount?: number;
  /** Entry block ID */
  entry: string;
  /** All basic blocks in the function */
  blocks: Map<string, Block>;
}

export namespace Function {
  /**
   * Local variable declaration
   */
  export interface LocalVariable {
    /** Variable name */
    name: string;
    /** Variable type */
    type: Type;
    /** Unique ID for this variable */
    id: string;
    /** Source location of declaration */
    loc?: Ast.SourceLocation;
  }
}
