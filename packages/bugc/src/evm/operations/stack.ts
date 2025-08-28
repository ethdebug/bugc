import { $ } from "./hkts";

export type StackBrand =
  | "a"
  | "b"
  | "a + b"
  | "a * b"
  | "a - b"
  | "a // b"
  | "a % b"
  | "N"
  | "(a + b) % N"
  | "(a * b) % N"
  | "exponent"
  | "a ** exponent"
  | "x"
  | "y"
  | "a < b"
  | "a > b"
  | "a == b"
  | "a == 0"
  | "a & b"
  | "a | b"
  | "a ^ b"
  | "~a"
  | "i"
  | "shift"
  | "value"
  | "value << shift"
  | "value >> shift"
  | "offset"
  | "size"
  | "hash"
  | "address"
  | "balance"
  | "data[i]"
  | "destOffset"
  | "price"
  | "blockNumber"
  | "timestamp"
  | "difficulty"
  | "gasLimit"
  | "chainId"
  | "baseFee"
  | "index"
  | "blobVersionedHashesAtIndex"
  | "blobBaseFee"
  | "key"
  | "counter"
  | "gas"
  | "topic"
  | "topic1"
  | "topic2"
  | "topic3"
  | "topic4"
  | "argsOffset"
  | "argsSize"
  | "retOffset"
  | "retSize"
  | "success"
  | "salt"
  | "unknown";

export type Stack = readonly StackBrand[];

export type StackItems<I, S extends Stack> = S extends unknown
  ? S extends readonly []
    ? readonly []
    : S extends readonly [
          infer B extends StackBrand,
          ...infer Rest extends Stack,
        ]
      ? readonly [$<I, [B]>, ...StackItems<I, Rest>]
      : never
  : never;

// Helper type to extract top N items from stack without modifying it
export type TopN<S extends Stack, N extends number> = S extends unknown
  ? N extends 0
    ? readonly []
    : N extends 1
      ? S extends readonly [infer E1 extends StackBrand, ...Stack]
        ? readonly [E1]
        : never
      : N extends 2
        ? S extends readonly [
            infer E1 extends StackBrand,
            infer E2 extends StackBrand,
            ...Stack,
          ]
          ? readonly [E1, E2]
          : never
        : N extends 3
          ? S extends readonly [
              infer E1 extends StackBrand,
              infer E2 extends StackBrand,
              infer E3 extends StackBrand,
              ...Stack,
            ]
            ? readonly [E1, E2, E3]
            : never
          : N extends 4
            ? S extends readonly [
                infer E1 extends StackBrand,
                infer E2 extends StackBrand,
                infer E3 extends StackBrand,
                infer E4 extends StackBrand,
                ...Stack,
              ]
              ? readonly [E1, E2, E3, E4]
              : never
            : N extends 5
              ? S extends readonly [
                  infer E1 extends StackBrand,
                  infer E2 extends StackBrand,
                  infer E3 extends StackBrand,
                  infer E4 extends StackBrand,
                  infer E5 extends StackBrand,
                  ...Stack,
                ]
                ? readonly [E1, E2, E3, E4, E5]
                : never
              : N extends 6
                ? S extends readonly [
                    infer E1 extends StackBrand,
                    infer E2 extends StackBrand,
                    infer E3 extends StackBrand,
                    infer E4 extends StackBrand,
                    infer E5 extends StackBrand,
                    infer E6 extends StackBrand,
                    ...Stack,
                  ]
                  ? readonly [E1, E2, E3, E4, E5, E6]
                  : never
                : N extends 7
                  ? S extends readonly [
                      infer E1 extends StackBrand,
                      infer E2 extends StackBrand,
                      infer E3 extends StackBrand,
                      infer E4 extends StackBrand,
                      infer E5 extends StackBrand,
                      infer E6 extends StackBrand,
                      infer E7 extends StackBrand,
                      ...Stack,
                    ]
                    ? readonly [E1, E2, E3, E4, E5, E6, E7]
                    : never
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
                        ...Stack,
                      ]
                      ? readonly [E1, E2, E3, E4, E5, E6, E7, E8]
                      : never
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
                          ...Stack,
                        ]
                        ? readonly [E1, E2, E3, E4, E5, E6, E7, E8, E9]
                        : never
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
                            ...Stack,
                          ]
                          ? readonly [E1, E2, E3, E4, E5, E6, E7, E8, E9, E10]
                          : never
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
                              ...Stack,
                            ]
                            ? readonly [
                                E1,
                                E2,
                                E3,
                                E4,
                                E5,
                                E6,
                                E7,
                                E8,
                                E9,
                                E10,
                                E11,
                              ]
                            : never
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
                                ...Stack,
                              ]
                              ? readonly [
                                  E1,
                                  E2,
                                  E3,
                                  E4,
                                  E5,
                                  E6,
                                  E7,
                                  E8,
                                  E9,
                                  E10,
                                  E11,
                                  E12,
                                ]
                              : never
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
                                  ...Stack,
                                ]
                                ? readonly [
                                    E1,
                                    E2,
                                    E3,
                                    E4,
                                    E5,
                                    E6,
                                    E7,
                                    E8,
                                    E9,
                                    E10,
                                    E11,
                                    E12,
                                    E13,
                                  ]
                                : never
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
                                    ...Stack,
                                  ]
                                  ? readonly [
                                      E1,
                                      E2,
                                      E3,
                                      E4,
                                      E5,
                                      E6,
                                      E7,
                                      E8,
                                      E9,
                                      E10,
                                      E11,
                                      E12,
                                      E13,
                                      E14,
                                    ]
                                  : never
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
                                      ...Stack,
                                    ]
                                    ? readonly [
                                        E1,
                                        E2,
                                        E3,
                                        E4,
                                        E5,
                                        E6,
                                        E7,
                                        E8,
                                        E9,
                                        E10,
                                        E11,
                                        E12,
                                        E13,
                                        E14,
                                        E15,
                                      ]
                                    : never
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
                                        ...Stack,
                                      ]
                                      ? readonly [
                                          E1,
                                          E2,
                                          E3,
                                          E4,
                                          E5,
                                          E6,
                                          E7,
                                          E8,
                                          E9,
                                          E10,
                                          E11,
                                          E12,
                                          E13,
                                          E14,
                                          E15,
                                          E16,
                                        ]
                                      : never
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
                                          ...Stack,
                                        ]
                                        ? readonly [
                                            E1,
                                            E2,
                                            E3,
                                            E4,
                                            E5,
                                            E6,
                                            E7,
                                            E8,
                                            E9,
                                            E10,
                                            E11,
                                            E12,
                                            E13,
                                            E14,
                                            E15,
                                            E16,
                                            E17,
                                          ]
                                        : never
                                      : never
  : never;

export type Push<S extends Stack, T extends Stack> = S extends unknown
  ? T extends unknown
    ? readonly [...T, ...S]
    : never
  : never;

// Helper type to remove N items from top of stack (index 1)
export type PopN<S extends Stack, N extends number> = S extends unknown
  ? N extends N
    ? N extends 0
      ? S
      : N extends 1
        ? S extends readonly [StackBrand, ...infer Rest extends Stack]
          ? Rest
          : never
        : N extends 2
          ? S extends readonly [
              StackBrand,
              StackBrand,
              ...infer Rest extends Stack,
            ]
            ? Rest
            : never
          : N extends 3
            ? S extends readonly [
                StackBrand,
                StackBrand,
                StackBrand,
                ...infer Rest extends Stack,
              ]
              ? Rest
              : never
            : N extends 4
              ? S extends readonly [
                  StackBrand,
                  StackBrand,
                  StackBrand,
                  StackBrand,
                  ...infer Rest extends Stack,
                ]
                ? Rest
                : never
              : N extends 5
                ? S extends readonly [
                    StackBrand,
                    StackBrand,
                    StackBrand,
                    StackBrand,
                    StackBrand,
                    ...infer Rest extends Stack,
                  ]
                  ? Rest
                  : never
                : N extends 6
                  ? S extends readonly [
                      StackBrand,
                      StackBrand,
                      StackBrand,
                      StackBrand,
                      StackBrand,
                      StackBrand,
                      ...infer Rest extends Stack,
                    ]
                    ? Rest
                    : never
                  : N extends 7
                    ? S extends readonly [
                        StackBrand,
                        StackBrand,
                        StackBrand,
                        StackBrand,
                        StackBrand,
                        StackBrand,
                        StackBrand,
                        ...infer Rest extends Stack,
                      ]
                      ? Rest
                      : never
                    : N extends 8
                      ? S extends readonly [
                          StackBrand,
                          StackBrand,
                          StackBrand,
                          StackBrand,
                          StackBrand,
                          StackBrand,
                          StackBrand,
                          StackBrand,
                          ...infer Rest extends Stack,
                        ]
                        ? Rest
                        : never
                      : N extends 9
                        ? S extends readonly [
                            StackBrand,
                            StackBrand,
                            StackBrand,
                            StackBrand,
                            StackBrand,
                            StackBrand,
                            StackBrand,
                            StackBrand,
                            StackBrand,
                            ...infer Rest extends Stack,
                          ]
                          ? Rest
                          : never
                        : N extends 10
                          ? S extends readonly [
                              StackBrand,
                              StackBrand,
                              StackBrand,
                              StackBrand,
                              StackBrand,
                              StackBrand,
                              StackBrand,
                              StackBrand,
                              StackBrand,
                              StackBrand,
                              ...infer Rest extends Stack,
                            ]
                            ? Rest
                            : never
                          : N extends 11
                            ? S extends readonly [
                                StackBrand,
                                StackBrand,
                                StackBrand,
                                StackBrand,
                                StackBrand,
                                StackBrand,
                                StackBrand,
                                StackBrand,
                                StackBrand,
                                StackBrand,
                                StackBrand,
                                ...infer Rest extends Stack,
                              ]
                              ? Rest
                              : never
                            : N extends 12
                              ? S extends readonly [
                                  StackBrand,
                                  StackBrand,
                                  StackBrand,
                                  StackBrand,
                                  StackBrand,
                                  StackBrand,
                                  StackBrand,
                                  StackBrand,
                                  StackBrand,
                                  StackBrand,
                                  StackBrand,
                                  StackBrand,
                                  ...infer Rest extends Stack,
                                ]
                                ? Rest
                                : never
                              : N extends 13
                                ? S extends readonly [
                                    StackBrand,
                                    StackBrand,
                                    StackBrand,
                                    StackBrand,
                                    StackBrand,
                                    StackBrand,
                                    StackBrand,
                                    StackBrand,
                                    StackBrand,
                                    StackBrand,
                                    StackBrand,
                                    StackBrand,
                                    StackBrand,
                                    ...infer Rest extends Stack,
                                  ]
                                  ? Rest
                                  : never
                                : N extends 14
                                  ? S extends readonly [
                                      StackBrand,
                                      StackBrand,
                                      StackBrand,
                                      StackBrand,
                                      StackBrand,
                                      StackBrand,
                                      StackBrand,
                                      StackBrand,
                                      StackBrand,
                                      StackBrand,
                                      StackBrand,
                                      StackBrand,
                                      StackBrand,
                                      StackBrand,
                                      ...infer Rest extends Stack,
                                    ]
                                    ? Rest
                                    : never
                                  : N extends 15
                                    ? S extends readonly [
                                        StackBrand,
                                        StackBrand,
                                        StackBrand,
                                        StackBrand,
                                        StackBrand,
                                        StackBrand,
                                        StackBrand,
                                        StackBrand,
                                        StackBrand,
                                        StackBrand,
                                        StackBrand,
                                        StackBrand,
                                        StackBrand,
                                        StackBrand,
                                        StackBrand,
                                        ...infer Rest extends Stack,
                                      ]
                                      ? Rest
                                      : never
                                    : N extends 16
                                      ? S extends readonly [
                                          StackBrand,
                                          StackBrand,
                                          StackBrand,
                                          StackBrand,
                                          StackBrand,
                                          StackBrand,
                                          StackBrand,
                                          StackBrand,
                                          StackBrand,
                                          StackBrand,
                                          StackBrand,
                                          StackBrand,
                                          StackBrand,
                                          StackBrand,
                                          StackBrand,
                                          StackBrand,
                                          ...infer Rest extends Stack,
                                        ]
                                        ? Rest
                                        : never
                                      : N extends 17
                                        ? S extends readonly [
                                            StackBrand,
                                            StackBrand,
                                            StackBrand,
                                            StackBrand,
                                            StackBrand,
                                            StackBrand,
                                            StackBrand,
                                            StackBrand,
                                            StackBrand,
                                            StackBrand,
                                            StackBrand,
                                            StackBrand,
                                            StackBrand,
                                            StackBrand,
                                            StackBrand,
                                            StackBrand,
                                            StackBrand,
                                            ...infer Rest extends Stack,
                                          ]
                                          ? Rest
                                          : never
                                        : never
    : never
  : never;
