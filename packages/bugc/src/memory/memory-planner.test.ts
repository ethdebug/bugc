import { describe, it, expect } from "vitest";
import { planFunctionMemory } from "./memory-planner";
import { analyzeLiveness } from "../liveness";
import type { IrFunction, BasicBlock } from "../ir";

describe("Memory Planning", () => {
  it("should allocate memory for phi destinations", () => {
    const func: IrFunction = {
      name: "test",
      locals: [],
      entry: "entry",
      blocks: new Map([
        [
          "entry",
          {
            id: "entry",
            phis: [],
            instructions: [
              {
                kind: "const",
                value: 1n,
                type: { kind: "uint", bits: 256 },
                dest: "%1",
              },
              {
                kind: "const",
                value: 2n,
                type: { kind: "uint", bits: 256 },
                dest: "%2",
              },
            ],
            terminator: {
              kind: "branch",
              condition: { kind: "const", value: true, type: { kind: "bool" } },
              trueTarget: "merge",
              falseTarget: "merge",
            },
            predecessors: new Set(),
          } as BasicBlock,
        ],
        [
          "merge",
          {
            id: "merge",
            phis: [
              {
                kind: "phi",
                sources: new Map([
                  [
                    "entry",
                    {
                      kind: "temp",
                      id: "%1",
                      type: { kind: "uint", bits: 256 },
                    },
                  ],
                ]),
                dest: "%3",
                type: { kind: "uint", bits: 256 },
              },
            ],
            instructions: [],
            terminator: { kind: "return" },
            predecessors: new Set(["entry"]),
          } as BasicBlock,
        ],
      ]),
    };

    const liveness = analyzeLiveness(func);
    const memoryResult = planFunctionMemory(func, liveness);

    expect(memoryResult.success).toBe(true);
    if (!memoryResult.success) throw new Error("Memory planning failed");

    const memory = memoryResult.value;

    // Phi destination %3 should be allocated memory
    expect("%3" in memory.allocations).toBe(true);
    // %1 is allocated first at 0x80, then %3 at 0xa0 (160)
    expect(memory.allocations["%3"]).toBe(0xa0);

    // Cross-block value %1 should also be allocated
    expect("%1" in memory.allocations).toBe(true);
    expect(memory.allocations["%1"]).toBe(0x80);
  });

  it("should allocate memory for cross-block values", () => {
    const func: IrFunction = {
      name: "test",
      locals: [],
      entry: "entry",
      blocks: new Map([
        [
          "entry",
          {
            id: "entry",
            phis: [],
            instructions: [
              {
                kind: "const",
                value: 42n,
                type: { kind: "uint", bits: 256 },
                dest: "%1",
              },
            ],
            terminator: {
              kind: "jump",
              target: "next",
            },
            predecessors: new Set(),
          } as BasicBlock,
        ],
        [
          "next",
          {
            id: "next",
            phis: [],
            instructions: [
              {
                kind: "binary",
                op: "add",
                left: {
                  kind: "temp",
                  id: "%1",
                  type: { kind: "uint", bits: 256 },
                },
                right: {
                  kind: "const",
                  value: 1n,
                  type: { kind: "uint", bits: 256 },
                },
                dest: "%2",
              },
            ],
            terminator: { kind: "return" },
            predecessors: new Set(["entry"]),
          } as BasicBlock,
        ],
      ]),
    };

    const liveness = analyzeLiveness(func);
    const memoryResult = planFunctionMemory(func, liveness);

    expect(memoryResult.success).toBe(true);
    if (!memoryResult.success) throw new Error("Memory planning failed");

    const memory = memoryResult.value;

    // %1 crosses block boundary, should be allocated
    expect("%1" in memory.allocations).toBe(true);
  });

  it("should allocate memory for deeply nested stack values", () => {
    const func: IrFunction = {
      name: "test",
      locals: [],
      entry: "entry",
      blocks: new Map([
        [
          "entry",
          {
            id: "entry",
            phis: [],
            instructions: [
              // Create many values to simulate deep stack
              ...Array.from({ length: 20 }, (_, i) => ({
                kind: "const" as const,
                value: BigInt(i),
                type: { kind: "uint" as const, bits: 256 },
                dest: `%${i}`,
              })),
            ],
            terminator: { kind: "return" },
            predecessors: new Set(),
          } as BasicBlock,
        ],
      ]),
    };

    const liveness = analyzeLiveness(func);
    const memoryResult = planFunctionMemory(func, liveness);

    expect(memoryResult.success).toBe(true);
    if (!memoryResult.success) throw new Error("Memory planning failed");

    const memory = memoryResult.value;

    // Some bottom values should be spilled to memory
    // (exact values depend on threshold, but some should be allocated)
    expect(Object.keys(memory.allocations).length).toBeGreaterThan(0);
  });

  it("should use sequential memory slots", () => {
    const func: IrFunction = {
      name: "test",
      locals: [],
      entry: "entry",
      blocks: new Map([
        [
          "entry",
          {
            id: "entry",
            phis: [],
            instructions: [],
            terminator: {
              kind: "jump",
              target: "block1",
            },
            predecessors: new Set(),
          } as BasicBlock,
        ],
        [
          "block1",
          {
            id: "block1",
            phis: [
              {
                kind: "phi",
                sources: new Map([
                  [
                    "entry",
                    {
                      kind: "const",
                      value: 1n,
                      type: { kind: "uint", bits: 256 },
                    },
                  ],
                ]),
                dest: "%phi1",
                type: { kind: "uint", bits: 256 },
              },
              {
                kind: "phi",
                sources: new Map([
                  [
                    "entry",
                    {
                      kind: "const",
                      value: 2n,
                      type: { kind: "uint", bits: 256 },
                    },
                  ],
                ]),
                dest: "%phi2",
                type: { kind: "uint", bits: 256 },
              },
            ],
            instructions: [],
            terminator: { kind: "return" },
            predecessors: new Set(["entry"]),
          } as BasicBlock,
        ],
      ]),
    };

    const liveness = analyzeLiveness(func);
    const memoryResult = planFunctionMemory(func, liveness);

    expect(memoryResult.success).toBe(true);
    if (!memoryResult.success) throw new Error("Memory planning failed");

    const memory = memoryResult.value;

    // Both phi destinations should be allocated
    expect("%phi1" in memory.allocations).toBe(true);
    expect("%phi2" in memory.allocations).toBe(true);

    // Should use sequential 32-byte slots
    const phi1Offset = memory.allocations["%phi1"];
    const phi2Offset = memory.allocations["%phi2"];
    expect(Math.abs(phi2Offset - phi1Offset)).toBe(32);

    // Free pointer should be after all allocations
    expect(memory.freePointer).toBeGreaterThanOrEqual(0x80 + 64);
  });
});
