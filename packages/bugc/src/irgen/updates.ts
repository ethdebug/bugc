import type { IrState } from "./state.js";
import type { Error as IrgenError } from "./errors.js";

/**
 * Add an error to the state
 */
export function addError(state: IrState, error: IrgenError): IrState {
  return {
    ...state,
    errors: [...state.errors, error],
  };
}

/**
 * Add a warning to the state
 */
export function addWarning(state: IrState, warning: IrgenError): IrState {
  return {
    ...state,
    warnings: [...state.warnings, warning],
  };
}
