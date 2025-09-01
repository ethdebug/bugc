import {
  type Stack,
  type StackBrand,
  type Operations as GenericOperations,
  type _,
  makeOperations,
  makeRebrands,
} from "../evm";

import { type GenState, type StackItem, controls } from "./state";

export const operations: GenericOperations<
  GenState<_ & Stack>,
  StackItem & { brand: _ & StackBrand }
> = makeOperations(controls);

export type Operations = typeof operations;

export const { rebrand, rebrandTop } = makeRebrands<GenState<_ & Stack>>();
