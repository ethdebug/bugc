/**
 * Stack rebranding utilities for changing semantic types of stack items.
 *
 * This module provides type-level operations for changing the semantic brands
 * of existing stack items without affecting the runtime stack structure.
 * Useful for refining types when more specific information becomes available.
 */

import { $ } from "./hkts";

import type { Stack, PopN, StackBrand } from "./stack";
/**
 * Rebrand stack items at specified positions.
 * Uses 1-based indexing to match EVM convention:
 * - Position 1 is the top of the stack
 * - Position 2 is the second item from top
 * - etc.
 *
 * This matches DUP and SWAP opcode numbering where DUP1
 * duplicates the 1st item (top), DUP2 duplicates the 2nd, etc.
 */
export const makeRebrands = <U>() => {
  const rebrand = <
    S extends Stack,
    Rebrands extends Record<number, StackBrand>,
  >(
    state: $<U, [S]>,
    _brands: Rebrands,
  ): $<U, [Rebranded<S, Rebrands>]> => {
    return state as $<U, [Rebranded<S, Rebrands>]>;
  };

  const rebrandTop = <
    A extends StackBrand,
    B extends StackBrand,
    S extends Stack,
  >(
    state: $<U, [readonly [A, ...S]]>,
    _brand: B,
  ): $<U, [readonly [B, ...S]]> => state as $<U, [readonly [B, ...S]]>;

  return { rebrand, rebrandTop };
};

export type Rebranded<
  S extends Stack,
  Rebrands extends Record<number, StackBrand>,
> = ApplyRebrands<S, Rebrands, MaxKey<Rebrands>>;

// Helper to get the highest key in the Rebrands record
type MaxKey<R extends Record<number, StackBrand>> = 17 extends keyof R
  ? 17
  : 16 extends keyof R
    ? 16
    : 15 extends keyof R
      ? 15
      : 14 extends keyof R
        ? 14
        : 13 extends keyof R
          ? 13
          : 12 extends keyof R
            ? 12
            : 11 extends keyof R
              ? 11
              : 10 extends keyof R
                ? 10
                : 9 extends keyof R
                  ? 9
                  : 8 extends keyof R
                    ? 8
                    : 7 extends keyof R
                      ? 7
                      : 6 extends keyof R
                        ? 6
                        : 5 extends keyof R
                          ? 5
                          : 4 extends keyof R
                            ? 4
                            : 3 extends keyof R
                              ? 3
                              : 2 extends keyof R
                                ? 2
                                : 1 extends keyof R
                                  ? 1
                                  : 0;

// Apply rebranding to the first N elements
type ApplyRebrands<
  S extends Stack,
  Rebrands extends Record<number, StackBrand>,
  N extends number,
> = N extends 0
  ? S
  : N extends 1
    ? S extends readonly [
        infer E1 extends StackBrand,
        ...infer _Rest extends Stack,
      ]
      ? readonly [
          ...[1 extends keyof Rebrands ? Rebrands[1] : E1],
          ...PopN<S, 1>,
        ]
      : S
    : N extends 2
      ? S extends readonly [
          infer E1 extends StackBrand,
          infer E2 extends StackBrand,
          ...infer Rest extends Stack,
        ]
        ? readonly [
            1 extends keyof Rebrands ? Rebrands[1] : E1,
            2 extends keyof Rebrands ? Rebrands[2] : E2,
            ...Rest,
          ]
        : S
      : N extends 3
        ? S extends readonly [
            infer E1 extends StackBrand,
            infer E2 extends StackBrand,
            infer E3 extends StackBrand,
            ...infer Rest extends Stack,
          ]
          ? readonly [
              1 extends keyof Rebrands ? Rebrands[1] : E1,
              2 extends keyof Rebrands ? Rebrands[2] : E2,
              3 extends keyof Rebrands ? Rebrands[3] : E3,
              ...Rest,
            ]
          : S
        : N extends 4
          ? S extends readonly [
              infer E1 extends StackBrand,
              infer E2 extends StackBrand,
              infer E3 extends StackBrand,
              infer E4 extends StackBrand,
              ...infer Rest extends Stack,
            ]
            ? readonly [
                1 extends keyof Rebrands ? Rebrands[1] : E1,
                2 extends keyof Rebrands ? Rebrands[2] : E2,
                3 extends keyof Rebrands ? Rebrands[3] : E3,
                4 extends keyof Rebrands ? Rebrands[4] : E4,
                ...Rest,
              ]
            : S
          : N extends 5
            ? S extends readonly [
                infer E1 extends StackBrand,
                infer E2 extends StackBrand,
                infer E3 extends StackBrand,
                infer E4 extends StackBrand,
                infer E5 extends StackBrand,
                ...infer Rest extends Stack,
              ]
              ? readonly [
                  1 extends keyof Rebrands ? Rebrands[1] : E1,
                  2 extends keyof Rebrands ? Rebrands[2] : E2,
                  3 extends keyof Rebrands ? Rebrands[3] : E3,
                  4 extends keyof Rebrands ? Rebrands[4] : E4,
                  5 extends keyof Rebrands ? Rebrands[5] : E5,
                  ...Rest,
                ]
              : S
            : N extends 6
              ? S extends readonly [
                  infer E1 extends StackBrand,
                  infer E2 extends StackBrand,
                  infer E3 extends StackBrand,
                  infer E4 extends StackBrand,
                  infer E5 extends StackBrand,
                  infer E6 extends StackBrand,
                  ...infer Rest extends Stack,
                ]
                ? readonly [
                    1 extends keyof Rebrands ? Rebrands[1] : E1,
                    2 extends keyof Rebrands ? Rebrands[2] : E2,
                    3 extends keyof Rebrands ? Rebrands[3] : E3,
                    4 extends keyof Rebrands ? Rebrands[4] : E4,
                    5 extends keyof Rebrands ? Rebrands[5] : E5,
                    6 extends keyof Rebrands ? Rebrands[6] : E6,
                    ...Rest,
                  ]
                : S
              : N extends 7
                ? S extends readonly [
                    infer E1 extends StackBrand,
                    infer E2 extends StackBrand,
                    infer E3 extends StackBrand,
                    infer E4 extends StackBrand,
                    infer E5 extends StackBrand,
                    infer E6 extends StackBrand,
                    infer E7 extends StackBrand,
                    ...infer Rest extends Stack,
                  ]
                  ? readonly [
                      1 extends keyof Rebrands ? Rebrands[1] : E1,
                      2 extends keyof Rebrands ? Rebrands[2] : E2,
                      3 extends keyof Rebrands ? Rebrands[3] : E3,
                      4 extends keyof Rebrands ? Rebrands[4] : E4,
                      5 extends keyof Rebrands ? Rebrands[5] : E5,
                      6 extends keyof Rebrands ? Rebrands[6] : E6,
                      7 extends keyof Rebrands ? Rebrands[7] : E7,
                      ...Rest,
                    ]
                  : S
                : N extends 8
                  ? S extends readonly [
                      infer E1 extends StackBrand,
                      infer E2 extends StackBrand,
                      infer E3 extends StackBrand,
                      infer E4 extends StackBrand,
                      infer E5 extends StackBrand,
                      infer E6 extends StackBrand,
                      infer E7 extends StackBrand,
                      infer E8 extends StackBrand,
                      ...infer Rest extends Stack,
                    ]
                    ? readonly [
                        1 extends keyof Rebrands ? Rebrands[1] : E1,
                        2 extends keyof Rebrands ? Rebrands[2] : E2,
                        3 extends keyof Rebrands ? Rebrands[3] : E3,
                        4 extends keyof Rebrands ? Rebrands[4] : E4,
                        5 extends keyof Rebrands ? Rebrands[5] : E5,
                        6 extends keyof Rebrands ? Rebrands[6] : E6,
                        7 extends keyof Rebrands ? Rebrands[7] : E7,
                        8 extends keyof Rebrands ? Rebrands[8] : E8,
                        ...Rest,
                      ]
                    : S
                  : N extends 9
                    ? S extends readonly [
                        infer E1 extends StackBrand,
                        infer E2 extends StackBrand,
                        infer E3 extends StackBrand,
                        infer E4 extends StackBrand,
                        infer E5 extends StackBrand,
                        infer E6 extends StackBrand,
                        infer E7 extends StackBrand,
                        infer E8 extends StackBrand,
                        infer E9 extends StackBrand,
                        ...infer Rest extends Stack,
                      ]
                      ? readonly [
                          1 extends keyof Rebrands ? Rebrands[1] : E1,
                          2 extends keyof Rebrands ? Rebrands[2] : E2,
                          3 extends keyof Rebrands ? Rebrands[3] : E3,
                          4 extends keyof Rebrands ? Rebrands[4] : E4,
                          5 extends keyof Rebrands ? Rebrands[5] : E5,
                          6 extends keyof Rebrands ? Rebrands[6] : E6,
                          7 extends keyof Rebrands ? Rebrands[7] : E7,
                          8 extends keyof Rebrands ? Rebrands[8] : E8,
                          9 extends keyof Rebrands ? Rebrands[9] : E9,
                          ...Rest,
                        ]
                      : S
                    : N extends 10
                      ? S extends readonly [
                          infer E1 extends StackBrand,
                          infer E2 extends StackBrand,
                          infer E3 extends StackBrand,
                          infer E4 extends StackBrand,
                          infer E5 extends StackBrand,
                          infer E6 extends StackBrand,
                          infer E7 extends StackBrand,
                          infer E8 extends StackBrand,
                          infer E9 extends StackBrand,
                          infer E10 extends StackBrand,
                          ...infer Rest extends Stack,
                        ]
                        ? readonly [
                            1 extends keyof Rebrands ? Rebrands[1] : E1,
                            2 extends keyof Rebrands ? Rebrands[2] : E2,
                            3 extends keyof Rebrands ? Rebrands[3] : E3,
                            4 extends keyof Rebrands ? Rebrands[4] : E4,
                            5 extends keyof Rebrands ? Rebrands[5] : E5,
                            6 extends keyof Rebrands ? Rebrands[6] : E6,
                            7 extends keyof Rebrands ? Rebrands[7] : E7,
                            8 extends keyof Rebrands ? Rebrands[8] : E8,
                            9 extends keyof Rebrands ? Rebrands[9] : E9,
                            10 extends keyof Rebrands ? Rebrands[10] : E10,
                            ...Rest,
                          ]
                        : S
                      : N extends 11
                        ? S extends readonly [
                            infer E1 extends StackBrand,
                            infer E2 extends StackBrand,
                            infer E3 extends StackBrand,
                            infer E4 extends StackBrand,
                            infer E5 extends StackBrand,
                            infer E6 extends StackBrand,
                            infer E7 extends StackBrand,
                            infer E8 extends StackBrand,
                            infer E9 extends StackBrand,
                            infer E10 extends StackBrand,
                            infer E11 extends StackBrand,
                            ...infer Rest extends Stack,
                          ]
                          ? readonly [
                              1 extends keyof Rebrands ? Rebrands[1] : E1,
                              2 extends keyof Rebrands ? Rebrands[2] : E2,
                              3 extends keyof Rebrands ? Rebrands[3] : E3,
                              4 extends keyof Rebrands ? Rebrands[4] : E4,
                              5 extends keyof Rebrands ? Rebrands[5] : E5,
                              6 extends keyof Rebrands ? Rebrands[6] : E6,
                              7 extends keyof Rebrands ? Rebrands[7] : E7,
                              8 extends keyof Rebrands ? Rebrands[8] : E8,
                              9 extends keyof Rebrands ? Rebrands[9] : E9,
                              10 extends keyof Rebrands ? Rebrands[10] : E10,
                              11 extends keyof Rebrands ? Rebrands[11] : E11,
                              ...Rest,
                            ]
                          : S
                        : N extends 12
                          ? S extends readonly [
                              infer E1 extends StackBrand,
                              infer E2 extends StackBrand,
                              infer E3 extends StackBrand,
                              infer E4 extends StackBrand,
                              infer E5 extends StackBrand,
                              infer E6 extends StackBrand,
                              infer E7 extends StackBrand,
                              infer E8 extends StackBrand,
                              infer E9 extends StackBrand,
                              infer E10 extends StackBrand,
                              infer E11 extends StackBrand,
                              infer E12 extends StackBrand,
                              ...infer Rest extends Stack,
                            ]
                            ? readonly [
                                1 extends keyof Rebrands ? Rebrands[1] : E1,
                                2 extends keyof Rebrands ? Rebrands[2] : E2,
                                3 extends keyof Rebrands ? Rebrands[3] : E3,
                                4 extends keyof Rebrands ? Rebrands[4] : E4,
                                5 extends keyof Rebrands ? Rebrands[5] : E5,
                                6 extends keyof Rebrands ? Rebrands[6] : E6,
                                7 extends keyof Rebrands ? Rebrands[7] : E7,
                                8 extends keyof Rebrands ? Rebrands[8] : E8,
                                9 extends keyof Rebrands ? Rebrands[9] : E9,
                                10 extends keyof Rebrands ? Rebrands[10] : E10,
                                11 extends keyof Rebrands ? Rebrands[11] : E11,
                                12 extends keyof Rebrands ? Rebrands[12] : E12,
                                ...Rest,
                              ]
                            : S
                          : N extends 13
                            ? S extends readonly [
                                infer E1 extends StackBrand,
                                infer E2 extends StackBrand,
                                infer E3 extends StackBrand,
                                infer E4 extends StackBrand,
                                infer E5 extends StackBrand,
                                infer E6 extends StackBrand,
                                infer E7 extends StackBrand,
                                infer E8 extends StackBrand,
                                infer E9 extends StackBrand,
                                infer E10 extends StackBrand,
                                infer E11 extends StackBrand,
                                infer E12 extends StackBrand,
                                infer E13 extends StackBrand,
                                ...infer Rest extends Stack,
                              ]
                              ? readonly [
                                  1 extends keyof Rebrands ? Rebrands[1] : E1,
                                  2 extends keyof Rebrands ? Rebrands[2] : E2,
                                  3 extends keyof Rebrands ? Rebrands[3] : E3,
                                  4 extends keyof Rebrands ? Rebrands[4] : E4,
                                  5 extends keyof Rebrands ? Rebrands[5] : E5,
                                  6 extends keyof Rebrands ? Rebrands[6] : E6,
                                  7 extends keyof Rebrands ? Rebrands[7] : E7,
                                  8 extends keyof Rebrands ? Rebrands[8] : E8,
                                  9 extends keyof Rebrands ? Rebrands[9] : E9,
                                  10 extends keyof Rebrands
                                    ? Rebrands[10]
                                    : E10,
                                  11 extends keyof Rebrands
                                    ? Rebrands[11]
                                    : E11,
                                  12 extends keyof Rebrands
                                    ? Rebrands[12]
                                    : E12,
                                  13 extends keyof Rebrands
                                    ? Rebrands[13]
                                    : E13,
                                  ...Rest,
                                ]
                              : S
                            : N extends 14
                              ? S extends readonly [
                                  infer E1 extends StackBrand,
                                  infer E2 extends StackBrand,
                                  infer E3 extends StackBrand,
                                  infer E4 extends StackBrand,
                                  infer E5 extends StackBrand,
                                  infer E6 extends StackBrand,
                                  infer E7 extends StackBrand,
                                  infer E8 extends StackBrand,
                                  infer E9 extends StackBrand,
                                  infer E10 extends StackBrand,
                                  infer E11 extends StackBrand,
                                  infer E12 extends StackBrand,
                                  infer E13 extends StackBrand,
                                  infer E14 extends StackBrand,
                                  ...infer Rest extends Stack,
                                ]
                                ? readonly [
                                    1 extends keyof Rebrands ? Rebrands[1] : E1,
                                    2 extends keyof Rebrands ? Rebrands[2] : E2,
                                    3 extends keyof Rebrands ? Rebrands[3] : E3,
                                    4 extends keyof Rebrands ? Rebrands[4] : E4,
                                    5 extends keyof Rebrands ? Rebrands[5] : E5,
                                    6 extends keyof Rebrands ? Rebrands[6] : E6,
                                    7 extends keyof Rebrands ? Rebrands[7] : E7,
                                    8 extends keyof Rebrands ? Rebrands[8] : E8,
                                    9 extends keyof Rebrands ? Rebrands[9] : E9,
                                    10 extends keyof Rebrands
                                      ? Rebrands[10]
                                      : E10,
                                    11 extends keyof Rebrands
                                      ? Rebrands[11]
                                      : E11,
                                    12 extends keyof Rebrands
                                      ? Rebrands[12]
                                      : E12,
                                    13 extends keyof Rebrands
                                      ? Rebrands[13]
                                      : E13,
                                    14 extends keyof Rebrands
                                      ? Rebrands[14]
                                      : E14,
                                    ...Rest,
                                  ]
                                : S
                              : N extends 15
                                ? S extends readonly [
                                    infer E1 extends StackBrand,
                                    infer E2 extends StackBrand,
                                    infer E3 extends StackBrand,
                                    infer E4 extends StackBrand,
                                    infer E5 extends StackBrand,
                                    infer E6 extends StackBrand,
                                    infer E7 extends StackBrand,
                                    infer E8 extends StackBrand,
                                    infer E9 extends StackBrand,
                                    infer E10 extends StackBrand,
                                    infer E11 extends StackBrand,
                                    infer E12 extends StackBrand,
                                    infer E13 extends StackBrand,
                                    infer E14 extends StackBrand,
                                    infer E15 extends StackBrand,
                                    ...infer Rest extends Stack,
                                  ]
                                  ? readonly [
                                      1 extends keyof Rebrands
                                        ? Rebrands[1]
                                        : E1,
                                      2 extends keyof Rebrands
                                        ? Rebrands[2]
                                        : E2,
                                      3 extends keyof Rebrands
                                        ? Rebrands[3]
                                        : E3,
                                      4 extends keyof Rebrands
                                        ? Rebrands[4]
                                        : E4,
                                      5 extends keyof Rebrands
                                        ? Rebrands[5]
                                        : E5,
                                      6 extends keyof Rebrands
                                        ? Rebrands[6]
                                        : E6,
                                      7 extends keyof Rebrands
                                        ? Rebrands[7]
                                        : E7,
                                      8 extends keyof Rebrands
                                        ? Rebrands[8]
                                        : E8,
                                      9 extends keyof Rebrands
                                        ? Rebrands[9]
                                        : E9,
                                      10 extends keyof Rebrands
                                        ? Rebrands[10]
                                        : E10,
                                      11 extends keyof Rebrands
                                        ? Rebrands[11]
                                        : E11,
                                      12 extends keyof Rebrands
                                        ? Rebrands[12]
                                        : E12,
                                      13 extends keyof Rebrands
                                        ? Rebrands[13]
                                        : E13,
                                      14 extends keyof Rebrands
                                        ? Rebrands[14]
                                        : E14,
                                      15 extends keyof Rebrands
                                        ? Rebrands[15]
                                        : E15,
                                      ...Rest,
                                    ]
                                  : S
                                : N extends 16
                                  ? S extends readonly [
                                      infer E1 extends StackBrand,
                                      infer E2 extends StackBrand,
                                      infer E3 extends StackBrand,
                                      infer E4 extends StackBrand,
                                      infer E5 extends StackBrand,
                                      infer E6 extends StackBrand,
                                      infer E7 extends StackBrand,
                                      infer E8 extends StackBrand,
                                      infer E9 extends StackBrand,
                                      infer E10 extends StackBrand,
                                      infer E11 extends StackBrand,
                                      infer E12 extends StackBrand,
                                      infer E13 extends StackBrand,
                                      infer E14 extends StackBrand,
                                      infer E15 extends StackBrand,
                                      infer E16 extends StackBrand,
                                      ...infer Rest extends Stack,
                                    ]
                                    ? readonly [
                                        1 extends keyof Rebrands
                                          ? Rebrands[1]
                                          : E1,
                                        2 extends keyof Rebrands
                                          ? Rebrands[2]
                                          : E2,
                                        3 extends keyof Rebrands
                                          ? Rebrands[3]
                                          : E3,
                                        4 extends keyof Rebrands
                                          ? Rebrands[4]
                                          : E4,
                                        5 extends keyof Rebrands
                                          ? Rebrands[5]
                                          : E5,
                                        6 extends keyof Rebrands
                                          ? Rebrands[6]
                                          : E6,
                                        7 extends keyof Rebrands
                                          ? Rebrands[7]
                                          : E7,
                                        8 extends keyof Rebrands
                                          ? Rebrands[8]
                                          : E8,
                                        9 extends keyof Rebrands
                                          ? Rebrands[9]
                                          : E9,
                                        10 extends keyof Rebrands
                                          ? Rebrands[10]
                                          : E10,
                                        11 extends keyof Rebrands
                                          ? Rebrands[11]
                                          : E11,
                                        12 extends keyof Rebrands
                                          ? Rebrands[12]
                                          : E12,
                                        13 extends keyof Rebrands
                                          ? Rebrands[13]
                                          : E13,
                                        14 extends keyof Rebrands
                                          ? Rebrands[14]
                                          : E14,
                                        15 extends keyof Rebrands
                                          ? Rebrands[15]
                                          : E15,
                                        16 extends keyof Rebrands
                                          ? Rebrands[16]
                                          : E16,
                                        ...Rest,
                                      ]
                                    : S
                                  : N extends 17
                                    ? S extends readonly [
                                        infer E1 extends StackBrand,
                                        infer E2 extends StackBrand,
                                        infer E3 extends StackBrand,
                                        infer E4 extends StackBrand,
                                        infer E5 extends StackBrand,
                                        infer E6 extends StackBrand,
                                        infer E7 extends StackBrand,
                                        infer E8 extends StackBrand,
                                        infer E9 extends StackBrand,
                                        infer E10 extends StackBrand,
                                        infer E11 extends StackBrand,
                                        infer E12 extends StackBrand,
                                        infer E13 extends StackBrand,
                                        infer E14 extends StackBrand,
                                        infer E15 extends StackBrand,
                                        infer E16 extends StackBrand,
                                        infer E17 extends StackBrand,
                                        ...infer Rest extends Stack,
                                      ]
                                      ? readonly [
                                          1 extends keyof Rebrands
                                            ? Rebrands[1]
                                            : E1,
                                          2 extends keyof Rebrands
                                            ? Rebrands[2]
                                            : E2,
                                          3 extends keyof Rebrands
                                            ? Rebrands[3]
                                            : E3,
                                          4 extends keyof Rebrands
                                            ? Rebrands[4]
                                            : E4,
                                          5 extends keyof Rebrands
                                            ? Rebrands[5]
                                            : E5,
                                          6 extends keyof Rebrands
                                            ? Rebrands[6]
                                            : E6,
                                          7 extends keyof Rebrands
                                            ? Rebrands[7]
                                            : E7,
                                          8 extends keyof Rebrands
                                            ? Rebrands[8]
                                            : E8,
                                          9 extends keyof Rebrands
                                            ? Rebrands[9]
                                            : E9,
                                          10 extends keyof Rebrands
                                            ? Rebrands[10]
                                            : E10,
                                          11 extends keyof Rebrands
                                            ? Rebrands[11]
                                            : E11,
                                          12 extends keyof Rebrands
                                            ? Rebrands[12]
                                            : E12,
                                          13 extends keyof Rebrands
                                            ? Rebrands[13]
                                            : E13,
                                          14 extends keyof Rebrands
                                            ? Rebrands[14]
                                            : E14,
                                          15 extends keyof Rebrands
                                            ? Rebrands[15]
                                            : E15,
                                          16 extends keyof Rebrands
                                            ? Rebrands[16]
                                            : E16,
                                          17 extends keyof Rebrands
                                            ? Rebrands[17]
                                            : E17,
                                          ...Rest,
                                        ]
                                      : S
                                    : S;
