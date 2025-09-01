import {
  type Stack,
  type StackBrand,
  type Instruction,
  type UnsafeStateControls,
  type StateControls,
  type _,
  makeStateControls,
} from "../../evm";

import type { FunctionMemoryLayout } from "../analysis/memory";
import type { EvmError } from "../errors";

// Track stack at type level
export interface GenState<S extends Stack> {
  brands: S;
  stack: StackItem[];
  nextId: number; // For generating unique IDs
  instructions: Instruction[];
  memory: FunctionMemoryLayout;
  blockOffsets: Record<string, number>;
  patches: {
    index: number;
    target: string;
  }[];
  warnings: EvmError[];
}

export interface StackItem {
  id: string;
  irValue?: string; // Optional IR value ID (e.g., "t1", "t2")
}

const unsafe: UnsafeStateControls<
  GenState<_ & Stack>,
  StackItem & { brand: _ & StackBrand }
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

export const controls: StateControls<
  GenState<_ & Stack>,
  StackItem & { brand: _ & StackBrand }
> = makeStateControls(unsafe);
