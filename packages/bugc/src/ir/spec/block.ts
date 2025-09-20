import type * as Ast from "#ast";

import { Value } from "./value.js";
import type { Type } from "./type.js";
import type { Instruction } from "./instruction.js";

/**
 * Basic block - sequence of instructions with single entry/exit
 */
export interface Block {
  /** Unique block ID */
  id: string;
  /** Phi nodes must be at the beginning of the block */
  phis: Block.Phi[];
  /** Instructions in execution order (after phi nodes) */
  instructions: Instruction[];
  /** Terminal instruction (jump, conditional jump, or return) */
  terminator: Block.Terminator;
  /** Predecessor block IDs (for CFG construction) */
  predecessors: Set<string>;
  /** Source location (e.g., for if/while blocks) */
  loc?: Ast.SourceLocation;
}

export namespace Block {
  /**
   * Block terminator instructions
   */
  export type Terminator =
    | { kind: "jump"; target: string; loc?: Ast.SourceLocation }
    | {
        kind: "branch";
        condition: Value;
        trueTarget: string;
        falseTarget: string;
        loc?: Ast.SourceLocation;
      }
    | { kind: "return"; value?: Value; loc?: Ast.SourceLocation }
    | {
        kind: "call";
        function: string;
        arguments: Value[];
        dest?: string;
        continuation: string;
        loc?: Ast.SourceLocation;
      };

  export interface Phi {
    kind: "phi";
    /** Map from predecessor block ID to value */
    sources: Map<string, Value>;
    /** Destination temp to assign the phi result */
    dest: string;
    /** Type of the phi node (all sources must have same type) */
    type: Type;
    loc?: Ast.SourceLocation;
  }
}
