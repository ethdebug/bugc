import type * as Ir from "../../../ir";
import type { Stack } from "../../../evm";
import type { GenState } from "../../operations";

/**
 * Get the ID for a value
 */
export function valueId(val: Ir.Value): string {
  if (val.kind === "const") {
    // Constants don't have stable IDs, we'll handle them specially
    return `$const_${val.value}`;
  } else if (val.kind === "temp") {
    return val.id;
  } else {
    return val.name;
  }
}

/**
 * Annotate the top stack item with an IR value
 */
export const annotateTop =
  (irValue: string) =>
  <S extends Stack>(state: GenState<S>): GenState<S> => {
    if (state.stack.length === 0) {
      throw new Error("Cannot annotate empty stack");
    }

    const newStack = [...state.stack];
    newStack[0] = {
      ...newStack[0],
      irValue,
    };

    return {
      ...state,
      stack: newStack,
    };
  };
