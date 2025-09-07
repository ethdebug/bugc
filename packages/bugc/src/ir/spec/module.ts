import type * as Ast from "#ast";

import type { Type } from "./type.js";
import type { Function as IrFunction } from "./function.js";

/**
 * Top-level Ir module representing a complete BUG program
 */
export interface Module {
  /** Program name from 'name' declaration */
  name: string;
  /** Storage layout information */
  storage: Module.StorageLayout;
  /** User-defined functions */
  functions: Map<string, IrFunction>;
  /** Constructor function (optional, for contract creation) */
  create?: IrFunction;
  /** The main code function (runtime code) */
  main: IrFunction;
  /** Source location of the program */
  loc?: Ast.SourceLocation;
}

export namespace Module {
  /**
   * Storage layout information
   */
  export interface StorageLayout {
    /** Storage slot assignments */
    slots: Module.StorageSlot[];
  }

  export interface StorageSlot {
    /** Slot number */
    slot: number;
    /** Variable name */
    name: string;
    /** Type of the storage variable */
    type: Type;
    /** Source location */
    loc?: Ast.SourceLocation;
  }
}
