import type * as Ast from "#ast";

import type { Type } from "./type.js";
import type { Block } from "./block.js";

/**
 * Ir function containing basic blocks
 */
export interface Function {
  /** Function name (for debugging) */
  name: string;
  /** Function parameters as temps (in SSA form) */
  parameters: Function.Parameter[];
  /** Entry block ID */
  entry: string;
  /** All basic blocks in the function */
  blocks: Map<string, Block>;
}

export namespace Function {
  /**
   * Function parameter in SSA form
   */
  export interface Parameter {
    /** Parameter name (for debugging) */
    name: string;
    /** Parameter type */
    type: Type;
    /** Temp ID for this parameter */
    tempId: string;
    /** Source location of declaration */
    loc?: Ast.SourceLocation;
  }
}
