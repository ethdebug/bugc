import type * as Format from "@ethdebug/format";

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
  /** Debug information (e.g., for if/while blocks) */
  debug: Block.Debug;
}

export namespace Block {
  /**
   * Debug information for blocks, terminators, and phi nodes
   */
  export interface Debug {
    context?: Format.Program.Context;
  }

  /**
   * Block terminator instructions
   */
  export type Terminator =
    | { kind: "jump"; target: string; debug: Block.Debug }
    | {
        kind: "branch";
        condition: Value;
        trueTarget: string;
        falseTarget: string;
        debug: Block.Debug;
      }
    | { kind: "return"; value?: Value; debug: Block.Debug }
    | {
        kind: "call";
        function: string;
        arguments: Value[];
        dest?: string;
        continuation: string;
        debug: Block.Debug;
      };

  export interface Phi {
    kind: "phi";
    /** Map from predecessor block ID to value */
    sources: Map<string, Value>;
    /** Destination temp to assign the phi result */
    dest: string;
    /** Type of the phi node (all sources must have same type) */
    type: Type;
    debug: Block.Debug;
  }
}
