import * as Evm from "#evm";
import { type _ } from "#evm";

import * as Analysis from "#evmgen/analysis";
import type { Error } from "#evmgen/errors";

// Track stack at type level
export interface State<S extends Evm.Stack> {
  brands: S;
  stack: StackItem[];
  nextId: number; // For generating unique IDs
  instructions: Evm.Instruction[];
  memory: Analysis.Memory.Function.Info;
  blockOffsets: Record<string, number>;
  patches: {
    index: number;
    target: string;
  }[];
  warnings: Error[];
}

export interface StackItem {
  id: string;
  irValue?: string; // Optional IR value ID (e.g., "t1", "t2")
}

const unsafe: Evm.Unsafe.StateControls<
  State<_ & Evm.Stack>,
  StackItem & { brand: _ & Evm.Stack.Brand }
> = {
  slice: (state, ...args) => ({
    ...state,
    stack: state.stack.slice(...args),
    brands: state.brands.slice(...args),
  }),
  prepend: (state, item) => ({
    ...state,
    stack: [{ id: item.id }, ...state.stack],
    brands: [item.brand, ...state.brands],
  }),
  create: (id, brand) => ({
    id,
    brand,
  }),
  duplicate: (item, id) => ({
    ...item,
    id,
  }),
  rebrand: (item, brand) => ({
    ...item,
    brand,
  }),
  readTop: (state, num) => {
    // Return the top N stack items with their IDs and brands
    const items = [];
    for (let i = 0; i < num && i < state.stack.length; i++) {
      items.push({
        ...state.stack[i], // Preserves id and irValue
        brand: state.brands[i],
      });
    }
    return items;
  },
  generateId: (state, prefix = "id") => ({
    id: `${prefix}_${state.nextId}`,
    state: {
      ...state,
      nextId: state.nextId + 1,
    },
  }),
  emit: (state, instruction) => ({
    ...state,
    instructions: [...state.instructions, instruction],
  }),
};

export const controls: Evm.State.Controls<
  State<_ & Evm.Stack>,
  StackItem & { brand: _ & Evm.Stack.Brand }
> = Evm.State.makeControls(unsafe);
