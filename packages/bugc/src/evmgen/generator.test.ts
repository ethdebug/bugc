import { describe, it, expect } from "vitest";
import { generateModule } from "./generator";
import { generateFunction } from "./ir-handlers";
import type { IrFunction, IrModule, BasicBlock } from "../ir";
import type { MemoryAllocation } from "./analysis/memory";

// Helper to create memory allocations for tests
function makeAllocation(offset: number, size: number = 32): MemoryAllocation {
  return { offset, size };
}
import type { FunctionMemoryLayout as MemoryLayout } from "./analysis/memory";
import type { FunctionBlockLayout as BlockLayout } from "./analysis/layout";
import { analyzeLiveness } from "./analysis/liveness";
import { planFunctionMemory } from "./analysis/memory";
import { layoutBlocks } from "./analysis/layout";

describe("EVM Code Generator", () => {
  describe("generateFunction", () => {
    it("should generate bytecode for simple constants", () => {
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
              terminator: { kind: "return" },
              predecessors: new Set(),
            } as BasicBlock,
          ],
        ]),
      };

      const memory: MemoryLayout = {
        allocations: {},
        freePointer: 0x80,
      };

      const layout: BlockLayout = {
        order: ["entry"],
        offsets: new Map(),
      };

      const { instructions } = generateFunction(func, memory, layout);

      // Should have PUSH1 42 (no JUMPDEST for entry with no predecessors, no STOP since it's the last block)
      expect(instructions).toHaveLength(1);
      expect(instructions[0]).toMatchObject({
        mnemonic: "PUSH1",
        immediates: [42],
      });
    });

    it("should generate binary operations", () => {
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
                  value: 10n,
                  type: { kind: "uint", bits: 256 },
                  dest: "%1",
                },
                {
                  kind: "const",
                  value: 20n,
                  type: { kind: "uint", bits: 256 },
                  dest: "%2",
                },
                {
                  kind: "binary",
                  op: "add",
                  left: {
                    kind: "temp",
                    id: "%1",
                    type: { kind: "uint", bits: 256 },
                  },
                  right: {
                    kind: "temp",
                    id: "%2",
                    type: { kind: "uint", bits: 256 },
                  },
                  dest: "%3",
                },
              ],
              terminator: { kind: "return" },
              predecessors: new Set(),
            } as BasicBlock,
          ],
        ]),
      };

      const memory: MemoryLayout = {
        allocations: {
          "%1": makeAllocation(0x80),
          "%2": makeAllocation(0xa0),
          "%3": makeAllocation(0xc0),
        },
        freePointer: 0xe0,
      };

      const layout: BlockLayout = {
        order: ["entry"],
        offsets: new Map(),
      };

      const { instructions } = generateFunction(func, memory, layout);

      // Should contain ADD instruction
      expect(instructions.some((inst) => inst.mnemonic === "ADD")).toBe(true);

      // Should have memory stores (MSTORE instructions)
      expect(instructions.some((inst) => inst.mnemonic === "MSTORE")).toBe(
        true,
      );
    });

    it("should handle jumps between blocks", () => {
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
              instructions: [],
              terminator: { kind: "return" },
              predecessors: new Set(["entry"]),
            } as BasicBlock,
          ],
        ]),
      };

      const memory: MemoryLayout = {
        allocations: {},
        freePointer: 0x80,
      };

      const layout: BlockLayout = {
        order: ["entry", "next"],
        offsets: new Map(),
      };

      const { instructions } = generateFunction(func, memory, layout);

      // Should have JUMP instruction
      expect(instructions.some((inst) => inst.mnemonic === "JUMP")).toBe(true);

      // Should have one JUMPDEST (only for the 'next' block which is jumped to)
      const jumpdests = instructions.filter(
        (inst) => inst.mnemonic === "JUMPDEST",
      );
      expect(jumpdests).toHaveLength(1);

      // Should have PUSH2 for jump target
      const push2Instructions = instructions.filter(
        (inst) => inst.mnemonic === "PUSH2",
      );
      expect(push2Instructions).toHaveLength(1);

      // Target should be patched (not [0, 0])
      const push2 = push2Instructions[0];
      expect(push2.immediates).toBeDefined();
      expect(push2.immediates!.length).toBe(2);
      const target = (push2.immediates![0] << 8) | push2.immediates![1];
      expect(target).toBeGreaterThan(0);
    });

    it("should handle conditional branches", () => {
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
                  type: { kind: "bool" },
                  dest: "%cond",
                },
              ],
              terminator: {
                kind: "branch",
                condition: {
                  kind: "temp",
                  id: "%cond",
                  type: { kind: "bool" },
                },
                trueTarget: "then",
                falseTarget: "else",
              },
              predecessors: new Set(),
            } as BasicBlock,
          ],
          [
            "then",
            {
              id: "then",
              phis: [],
              instructions: [],
              terminator: { kind: "return" },
              predecessors: new Set(["entry"]),
            } as BasicBlock,
          ],
          [
            "else",
            {
              id: "else",
              phis: [],
              instructions: [],
              terminator: { kind: "return" },
              predecessors: new Set(["entry"]),
            } as BasicBlock,
          ],
        ]),
      };

      const memory: MemoryLayout = {
        allocations: { "%cond": { offset: 0x80, size: 32 } },
        freePointer: 0xa0,
      };

      const layout: BlockLayout = {
        order: ["entry", "then", "else"],
        offsets: new Map(),
      };

      const { instructions } = generateFunction(func, memory, layout);

      // Should have JUMPI for conditional jump
      expect(instructions.some((inst) => inst.mnemonic === "JUMPI")).toBe(true);

      // Should have PUSH2 instructions for both targets
      const push2Instructions = instructions.filter(
        (inst) => inst.mnemonic === "PUSH2",
      );
      expect(push2Instructions.length).toBe(2);

      // Should have JUMP for unconditional fallthrough
      expect(instructions.some((inst) => inst.mnemonic === "JUMP")).toBe(true);
    });

    it("should handle storage operations", () => {
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
                  value: 0n,
                  type: { kind: "uint", bits: 256 },
                  dest: "%slot",
                },
                {
                  kind: "const",
                  value: 42n,
                  type: { kind: "uint", bits: 256 },
                  dest: "%value",
                },
                {
                  kind: "store_storage",
                  slot: {
                    kind: "temp",
                    id: "%slot",
                    type: { kind: "uint", bits: 256 },
                  },
                  value: {
                    kind: "temp",
                    id: "%value",
                    type: { kind: "uint", bits: 256 },
                  },
                },
              ],
              terminator: { kind: "return" },
              predecessors: new Set(),
            } as BasicBlock,
          ],
        ]),
      };

      const memory: MemoryLayout = {
        allocations: {
          "%slot": { offset: 0x80, size: 32 },
          "%value": { offset: 0xa0, size: 32 },
        },
        freePointer: 0xc0,
      };

      const layout: BlockLayout = {
        order: ["entry"],
        offsets: new Map(),
      };

      const { instructions } = generateFunction(func, memory, layout);

      // Should have SSTORE instruction
      expect(instructions.some((inst) => inst.mnemonic === "SSTORE")).toBe(
        true,
      );
    });

    it("should handle environment operations", () => {
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
                  kind: "env",
                  op: "msg_sender",
                  dest: "%sender",
                },
                {
                  kind: "env",
                  op: "msg_value",
                  dest: "%value",
                },
              ],
              terminator: { kind: "return" },
              predecessors: new Set(),
            } as BasicBlock,
          ],
        ]),
      };

      const memory: MemoryLayout = {
        allocations: {
          "%sender": { offset: 0x80, size: 20 },
          "%value": { offset: 0xa0, size: 32 },
        },
        freePointer: 0xc0,
      };

      const layout: BlockLayout = {
        order: ["entry"],
        offsets: new Map(),
      };

      const { instructions } = generateFunction(func, memory, layout);

      // Should have CALLER and CALLVALUE instructions
      expect(instructions.some((inst) => inst.mnemonic === "CALLER")).toBe(
        true,
      );
      expect(instructions.some((inst) => inst.mnemonic === "CALLVALUE")).toBe(
        true,
      );
    });

    it("should handle array slot computation", () => {
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
                  dest: "%value",
                },
                {
                  kind: "const",
                  value: 3n,
                  type: { kind: "uint", bits: 256 },
                  dest: "%index",
                },
                {
                  kind: "compute_array_slot",
                  baseSlot: {
                    kind: "const",
                    value: 0n,
                    type: { kind: "uint", bits: 256 },
                  },
                  dest: "%arrayBase",
                },
                {
                  kind: "binary",
                  op: "add",
                  left: {
                    kind: "temp",
                    id: "%arrayBase",
                    type: { kind: "uint", bits: 256 },
                  },
                  right: {
                    kind: "temp",
                    id: "%index",
                    type: { kind: "uint", bits: 256 },
                  },
                  dest: "%slot",
                },
                {
                  kind: "store_storage",
                  slot: {
                    kind: "temp",
                    id: "%slot",
                    type: { kind: "uint", bits: 256 },
                  },
                  value: {
                    kind: "temp",
                    id: "%value",
                    type: { kind: "uint", bits: 256 },
                  },
                },
              ],
              terminator: { kind: "return" },
              predecessors: new Set(),
            } as BasicBlock,
          ],
        ]),
      };

      const memory: MemoryLayout = {
        allocations: {
          "%value": { offset: 0x80, size: 32 },
          "%index": { offset: 0xa0, size: 32 },
          "%arrayBase": { offset: 0xc0, size: 32 },
          "%slot": { offset: 0xe0, size: 32 },
        },
        freePointer: 0x100,
      };

      const layout: BlockLayout = {
        order: ["entry"],
        offsets: new Map(),
      };

      const { instructions } = generateFunction(func, memory, layout);

      // Should contain KECCAK256 for array slot computation
      expect(instructions.some((inst) => inst.mnemonic === "KECCAK256")).toBe(
        true,
      );

      // Should contain MSTORE instructions for hash setup
      const mstores = instructions.filter((inst) => inst.mnemonic === "MSTORE");
      expect(mstores.length).toBeGreaterThanOrEqual(1);

      // Should contain ADD for index offset
      expect(instructions.some((inst) => inst.mnemonic === "ADD")).toBe(true);

      // Should contain SSTORE for storage write
      expect(instructions.some((inst) => inst.mnemonic === "SSTORE")).toBe(
        true,
      );
    });

    it("should handle array element load", () => {
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
                  value: 2n,
                  type: { kind: "uint", bits: 256 },
                  dest: "%index",
                },
                {
                  kind: "compute_array_slot",
                  baseSlot: {
                    kind: "const",
                    value: 0n,
                    type: { kind: "uint", bits: 256 },
                  },
                  dest: "%arrayBase",
                },
                {
                  kind: "binary",
                  op: "add",
                  left: {
                    kind: "temp",
                    id: "%arrayBase",
                    type: { kind: "uint", bits: 256 },
                  },
                  right: {
                    kind: "temp",
                    id: "%index",
                    type: { kind: "uint", bits: 256 },
                  },
                  dest: "%slot",
                },
                {
                  kind: "load_storage",
                  slot: {
                    kind: "temp",
                    id: "%slot",
                    type: { kind: "uint", bits: 256 },
                  },
                  type: { kind: "uint", bits: 256 },
                  dest: "%value",
                },
              ],
              terminator: {
                kind: "return",
                value: {
                  kind: "temp",
                  id: "%value",
                  type: { kind: "uint", bits: 256 },
                },
              },
              predecessors: new Set(),
            } as BasicBlock,
          ],
        ]),
      };

      const memory: MemoryLayout = {
        allocations: {
          "%index": { offset: 0x80, size: 32 },
          "%arrayBase": { offset: 0xa0, size: 32 },
          "%slot": { offset: 0xc0, size: 32 },
          "%value": { offset: 0xe0, size: 32 },
        },
        freePointer: 0x100,
      };

      const layout: BlockLayout = {
        order: ["entry"],
        offsets: new Map(),
      };

      const { instructions } = generateFunction(func, memory, layout);

      // Should compute array base with KECCAK256
      expect(instructions.some((inst) => inst.mnemonic === "KECCAK256")).toBe(
        true,
      );

      // Should add index to base
      expect(instructions.some((inst) => inst.mnemonic === "ADD")).toBe(true);

      // Should load from storage
      expect(instructions.some((inst) => inst.mnemonic === "SLOAD")).toBe(true);

      // No STOP at the end since it's the last block
      expect(instructions.some((inst) => inst.mnemonic === "STOP")).toBe(false);
    });

    it("should handle mapping slot computation", () => {
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
                  kind: "env",
                  op: "msg_sender",
                  dest: "%sender",
                },
                {
                  kind: "const",
                  value: 100n,
                  type: { kind: "uint", bits: 256 },
                  dest: "%value",
                },
                {
                  kind: "compute_slot",
                  baseSlot: {
                    kind: "const",
                    value: 1n,
                    type: { kind: "uint", bits: 256 },
                  },
                  key: {
                    kind: "temp",
                    id: "%sender",
                    type: { kind: "address" },
                  },
                  keyType: { kind: "address" },
                  dest: "%slot",
                },
                {
                  kind: "store_storage",
                  slot: {
                    kind: "temp",
                    id: "%slot",
                    type: { kind: "uint", bits: 256 },
                  },
                  value: {
                    kind: "temp",
                    id: "%value",
                    type: { kind: "uint", bits: 256 },
                  },
                },
              ],
              terminator: { kind: "return" },
              predecessors: new Set(),
            } as BasicBlock,
          ],
        ]),
      };

      const memory: MemoryLayout = {
        allocations: {
          "%sender": { offset: 0x80, size: 20 },
          "%value": { offset: 0xa0, size: 32 },
          "%slot": { offset: 0xc0, size: 32 },
        },
        freePointer: 0xe0,
      };

      const layout: BlockLayout = {
        order: ["entry"],
        offsets: new Map(),
      };

      const { instructions } = generateFunction(func, memory, layout);

      // Should have CALLER for msg.sender
      expect(instructions.some((inst) => inst.mnemonic === "CALLER")).toBe(
        true,
      );

      // Should have KECCAK256 for mapping slot computation
      expect(instructions.some((inst) => inst.mnemonic === "KECCAK256")).toBe(
        true,
      );

      // Should have SSTORE for final storage
      expect(instructions.some((inst) => inst.mnemonic === "SSTORE")).toBe(
        true,
      );
    });

    it("should handle mapping value load", () => {
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
                  kind: "env",
                  op: "msg_sender",
                  dest: "%sender",
                },
                {
                  kind: "compute_slot",
                  baseSlot: {
                    kind: "const",
                    value: 1n,
                    type: { kind: "uint", bits: 256 },
                  },
                  key: {
                    kind: "temp",
                    id: "%sender",
                    type: { kind: "address" },
                  },
                  keyType: { kind: "address" },
                  dest: "%slot",
                },
                {
                  kind: "load_storage",
                  slot: {
                    kind: "temp",
                    id: "%slot",
                    type: { kind: "uint", bits: 256 },
                  },
                  type: { kind: "uint", bits: 256 },
                  dest: "%balance",
                },
              ],
              terminator: {
                kind: "return",
                value: {
                  kind: "temp",
                  id: "%balance",
                  type: { kind: "uint", bits: 256 },
                },
              },
              predecessors: new Set(),
            } as BasicBlock,
          ],
        ]),
      };

      const memory: MemoryLayout = {
        allocations: {
          "%sender": { offset: 0x80, size: 20 },
          "%slot": { offset: 0xa0, size: 32 },
          "%balance": { offset: 0xc0, size: 32 },
        },
        freePointer: 0xe0,
      };

      const layout: BlockLayout = {
        order: ["entry"],
        offsets: new Map(),
      };

      const { instructions } = generateFunction(func, memory, layout);

      // Should get msg.sender
      expect(instructions.some((inst) => inst.mnemonic === "CALLER")).toBe(
        true,
      );

      // Should compute slot with KECCAK256
      expect(instructions.some((inst) => inst.mnemonic === "KECCAK256")).toBe(
        true,
      );

      // Should load from storage
      expect(instructions.some((inst) => inst.mnemonic === "SLOAD")).toBe(true);

      // Should have proper memory operations for hash
      const mstores = instructions.filter((inst) => inst.mnemonic === "MSTORE");
      expect(mstores.length).toBeGreaterThanOrEqual(2); // For key and baseSlot
    });

    it("should handle nested array/mapping access", () => {
      // Test something like: mapping<address, array<uint256>>
      // users[msg.sender][index]
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
                  kind: "env",
                  op: "msg_sender",
                  dest: "%sender",
                },
                {
                  kind: "const",
                  value: 5n,
                  type: { kind: "uint", bits: 256 },
                  dest: "%index",
                },
                // First compute mapping slot for users[msg.sender]
                {
                  kind: "compute_slot",
                  baseSlot: {
                    kind: "const",
                    value: 0n,
                    type: { kind: "uint", bits: 256 },
                  },
                  key: {
                    kind: "temp",
                    id: "%sender",
                    type: { kind: "address" },
                  },
                  keyType: { kind: "address" },
                  dest: "%userSlot",
                },
                // Then compute array base from that slot
                {
                  kind: "compute_array_slot",
                  baseSlot: {
                    kind: "temp",
                    id: "%userSlot",
                    type: { kind: "uint", bits: 256 },
                  },
                  dest: "%arrayBase",
                },
                // Add index to get final slot
                {
                  kind: "binary",
                  op: "add",
                  left: {
                    kind: "temp",
                    id: "%arrayBase",
                    type: { kind: "uint", bits: 256 },
                  },
                  right: {
                    kind: "temp",
                    id: "%index",
                    type: { kind: "uint", bits: 256 },
                  },
                  dest: "%finalSlot",
                },
                {
                  kind: "load_storage",
                  slot: {
                    kind: "temp",
                    id: "%finalSlot",
                    type: { kind: "uint", bits: 256 },
                  },
                  type: { kind: "uint", bits: 256 },
                  dest: "%value",
                },
              ],
              terminator: {
                kind: "return",
                value: {
                  kind: "temp",
                  id: "%value",
                  type: { kind: "uint", bits: 256 },
                },
              },
              predecessors: new Set(),
            } as BasicBlock,
          ],
        ]),
      };

      const memory: MemoryLayout = {
        allocations: {
          "%sender": { offset: 0x80, size: 20 },
          "%index": { offset: 0xa0, size: 32 },
          "%userSlot": { offset: 0xc0, size: 32 },
          "%arrayBase": { offset: 0xe0, size: 32 },
          "%finalSlot": { offset: 0x100, size: 32 },
          "%value": { offset: 0x120, size: 32 },
        },
        freePointer: 0x140,
      };

      const layout: BlockLayout = {
        order: ["entry"],
        offsets: new Map(),
      };

      const { instructions } = generateFunction(func, memory, layout);

      // Should have KECCAK256 operations for both mapping and array
      const keccakInstructions = instructions.filter(
        (inst) => inst.mnemonic === "KECCAK256",
      );
      // We expect at least 2 (one for mapping, one for array)
      expect(keccakInstructions.length).toBeGreaterThanOrEqual(2);

      // Should have ADD for index offset
      expect(instructions.some((inst) => inst.mnemonic === "ADD")).toBe(true);

      // Should load from storage
      expect(instructions.some((inst) => inst.mnemonic === "SLOAD")).toBe(true);
    });
  });

  describe("generateModule", () => {
    it("should generate runtime bytecode for module without constructor", () => {
      const module: IrModule = {
        name: "Test",
        storage: { slots: [] },
        functions: new Map(),
        main: {
          name: "main",
          locals: [],
          entry: "entry",
          blocks: new Map([
            [
              "entry",
              {
                id: "entry",
                phis: [],
                instructions: [],
                terminator: { kind: "return" },
                predecessors: new Set(),
              } as BasicBlock,
            ],
          ]),
        },
      };

      const memoryLayouts = {
        main: {
          allocations: {},
          freePointer: 0x80,
        },
        functions: {},
      };

      const blockLayouts = {
        main: {
          order: ["entry"],
          offsets: new Map(),
        },
        functions: {},
      };

      const result = generateModule(module, memoryLayouts, blockLayouts);

      expect(result.runtime).toBeDefined();
      expect(result.create).toBeDefined(); // Always generates constructor
      // Empty bytecode is valid - program does nothing
      expect(result.runtime.length).toBe(0);
      expect(result.create!.length).toBeGreaterThan(0); // Constructor needs deployment code
    });

    it("should generate deployment bytecode with constructor", () => {
      const module: IrModule = {
        name: "Test",
        storage: { slots: [] },
        functions: new Map(),
        create: {
          name: "create",
          locals: [],
          entry: "entry",
          blocks: new Map([
            [
              "entry",
              {
                id: "entry",
                phis: [],
                instructions: [],
                terminator: { kind: "return" },
                predecessors: new Set(),
              } as BasicBlock,
            ],
          ]),
        },
        main: {
          name: "main",
          locals: [],
          entry: "entry",
          blocks: new Map([
            [
              "entry",
              {
                id: "entry",
                phis: [],
                instructions: [],
                terminator: { kind: "return" },
                predecessors: new Set(),
              } as BasicBlock,
            ],
          ]),
        },
      };

      const memoryLayouts = {
        create: {
          allocations: {},
          freePointer: 0x80,
        },
        main: {
          allocations: {},
          freePointer: 0x80,
        },
        functions: {},
      };

      const blockLayouts = {
        create: {
          order: ["entry"],
          offsets: new Map(),
        },
        main: {
          order: ["entry"],
          offsets: new Map(),
        },
        functions: {},
      };

      const result = generateModule(module, memoryLayouts, blockLayouts);

      expect(result.runtime).toBeDefined();
      expect(result.create).toBeDefined();

      // Deployment bytecode should be longer (includes constructor + runtime)
      expect(result.create!.length).toBeGreaterThan(result.runtime.length);

      // Should have CODECOPY and RETURN instructions for deployment
      expect(
        result.createInstructions?.some((inst) => inst.mnemonic === "CODECOPY"),
      ).toBe(true);
      expect(
        result.createInstructions?.some((inst) => inst.mnemonic === "RETURN"),
      ).toBe(true);
    });

    it("should handle local variable operations", () => {
      const func: IrFunction = {
        name: "test",
        locals: [
          { id: "local_i", name: "i", type: { kind: "uint", bits: 256 } },
        ],
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
                  value: 0n,
                  type: { kind: "uint", bits: 256 },
                  dest: "%1",
                },
                {
                  kind: "store_local",
                  local: "local_i",
                  value: {
                    kind: "temp",
                    id: "%1",
                    type: { kind: "uint", bits: 256 },
                  },
                },
                {
                  kind: "load_local",
                  local: "local_i",
                  dest: "%2",
                },
                {
                  kind: "const",
                  value: 1n,
                  type: { kind: "uint", bits: 256 },
                  dest: "%3",
                },
                {
                  kind: "binary",
                  op: "add",
                  left: {
                    kind: "temp",
                    id: "%2",
                    type: { kind: "uint", bits: 256 },
                  },
                  right: {
                    kind: "temp",
                    id: "%3",
                    type: { kind: "uint", bits: 256 },
                  },
                  dest: "%4",
                },
                {
                  kind: "store_local",
                  local: "local_i",
                  value: {
                    kind: "temp",
                    id: "%4",
                    type: { kind: "uint", bits: 256 },
                  },
                },
              ],
              terminator: { kind: "return" },
              predecessors: new Set(),
            } as BasicBlock,
          ],
        ]),
      };

      const liveness = analyzeLiveness(func);
      const memoryResult = planFunctionMemory(func, liveness);
      if (!memoryResult.success) throw new Error("Memory planning failed");
      const memory = memoryResult.value;
      const layout = layoutBlocks(func);

      // Note: local_i might not be allocated to memory if it doesn't cross blocks
      // The memory planner only allocates values that need to persist across stack operations

      const { instructions } = generateFunction(func, memory, layout);

      // The instructions should handle the local operations correctly
      // Whether through stack manipulation or memory depends on the implementation

      // Should contain ADD for the increment
      expect(instructions.some((inst) => inst.mnemonic === "ADD")).toBe(true);
    });
  });
});
