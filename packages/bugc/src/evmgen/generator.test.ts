import { describe, it, expect } from "vitest";
import { generateFunction, generateModule } from "./generator";
import { OPCODES } from "../evm";
import type { IrFunction, IrModule, BasicBlock } from "../ir";
import type { FunctionMemoryLayout as MemoryLayout } from "../memory/memory-planner";
import type { FunctionBlockLayout as BlockLayout } from "../memory/block-layout";
import { analyzeLiveness } from "../liveness";
import { planFunctionMemory } from "../memory/memory-planner";
import { layoutBlocks } from "../memory/block-layout";

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

      const bytecode = generateFunction(func, memory, layout);

      // Should have PUSH1 42 (no JUMPDEST for entry with no predecessors, no STOP since it's the last block)
      expect(bytecode[0]).toBe(OPCODES.PUSH1);
      expect(bytecode[1]).toBe(42);
      // No STOP at the end since it's the last block
      expect(bytecode.length).toBe(2);
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
          "%1": 0x80,
          "%2": 0xa0,
          "%3": 0xc0,
        },
        freePointer: 0xe0,
      };

      const layout: BlockLayout = {
        order: ["entry"],
        offsets: new Map(),
      };

      const bytecode = generateFunction(func, memory, layout);

      // Should contain ADD opcode
      expect(bytecode).toContain(OPCODES.ADD);

      // Should have memory stores (MSTORE opcode)
      expect(bytecode).toContain(OPCODES.MSTORE);
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

      const bytecode = generateFunction(func, memory, layout);

      // Should have JUMP opcode
      expect(bytecode).toContain(OPCODES.JUMP);

      // Should have one JUMPDEST (only for the 'next' block which is jumped to)
      const jumpdests = bytecode.filter((b) => b === OPCODES.JUMPDEST);
      expect(jumpdests.length).toBe(1);

      // Should patch jump target correctly
      // Find PUSH2 before JUMP
      const jumpIndex = bytecode.indexOf(OPCODES.JUMP);
      expect(bytecode[jumpIndex - 3]).toBe(OPCODES.PUSH2);

      // Target should be patched (not 0x00 0x00)
      const targetHigh = bytecode[jumpIndex - 2];
      const targetLow = bytecode[jumpIndex - 1];
      const target = (targetHigh << 8) | targetLow;
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
        allocations: { "%cond": 0x80 },
        freePointer: 0xa0,
      };

      const layout: BlockLayout = {
        order: ["entry", "then", "else"],
        offsets: new Map(),
      };

      const bytecode = generateFunction(func, memory, layout);

      // Should have JUMPI for conditional jump
      expect(bytecode).toContain(OPCODES.JUMPI);

      // After JUMPI, there should be PUSH2 for false target, then JUMP
      const jumpiIndex = bytecode.indexOf(OPCODES.JUMPI);
      expect(bytecode[jumpiIndex + 1]).toBe(OPCODES.PUSH2); // 0x61
      expect(bytecode[jumpiIndex + 4]).toBe(OPCODES.JUMP); // After PUSH2 and its 2 bytes
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
          "%slot": 0x80,
          "%value": 0xa0,
        },
        freePointer: 0xc0,
      };

      const layout: BlockLayout = {
        order: ["entry"],
        offsets: new Map(),
      };

      const bytecode = generateFunction(func, memory, layout);

      // Should have SSTORE opcode
      expect(bytecode).toContain(OPCODES.SSTORE);
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
          "%sender": 0x80,
          "%value": 0xa0,
        },
        freePointer: 0xc0,
      };

      const layout: BlockLayout = {
        order: ["entry"],
        offsets: new Map(),
      };

      const bytecode = generateFunction(func, memory, layout);

      // Should have CALLER and CALLVALUE opcodes
      expect(bytecode).toContain(OPCODES.CALLER);
      expect(bytecode).toContain(OPCODES.CALLVALUE);
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
          "%value": 0x80,
          "%index": 0xa0,
          "%arrayBase": 0xc0,
          "%slot": 0xe0,
        },
        freePointer: 0x100,
      };

      const layout: BlockLayout = {
        order: ["entry"],
        offsets: new Map(),
      };

      const bytecode = generateFunction(func, memory, layout);

      // Should contain KECCAK256 for array slot computation
      expect(bytecode).toContain(OPCODES.KECCAK256);

      // Should contain MSTORE operations for hash setup
      const mstores = bytecode.filter((b) => b === OPCODES.MSTORE);
      expect(mstores.length).toBeGreaterThanOrEqual(1);

      // Should contain ADD for index offset
      expect(bytecode).toContain(OPCODES.ADD);

      // Should contain SSTORE for storage write
      expect(bytecode).toContain(OPCODES.SSTORE);
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
          "%index": 0x80,
          "%arrayBase": 0xa0,
          "%slot": 0xc0,
          "%value": 0xe0,
        },
        freePointer: 0x100,
      };

      const layout: BlockLayout = {
        order: ["entry"],
        offsets: new Map(),
      };

      const bytecode = generateFunction(func, memory, layout);

      // Should compute array base with KECCAK256
      expect(bytecode).toContain(OPCODES.KECCAK256);

      // Should add index to base
      expect(bytecode).toContain(OPCODES.ADD);

      // Should load from storage
      expect(bytecode).toContain(OPCODES.SLOAD);

      // No STOP at the end since it's the last block
      const stopIndex = bytecode.indexOf(OPCODES.STOP);
      expect(stopIndex).toBe(-1);
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
          "%sender": 0x80,
          "%value": 0xa0,
          "%slot": 0xc0,
        },
        freePointer: 0xe0,
      };

      const layout: BlockLayout = {
        order: ["entry"],
        offsets: new Map(),
      };

      const bytecode = generateFunction(func, memory, layout);

      // Should have CALLER for msg.sender
      expect(bytecode).toContain(OPCODES.CALLER);

      // Should have KECCAK256 for mapping slot computation
      expect(bytecode).toContain(OPCODES.KECCAK256);

      // Should have SSTORE for final storage
      expect(bytecode).toContain(OPCODES.SSTORE);
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
          "%sender": 0x80,
          "%slot": 0xa0,
          "%balance": 0xc0,
        },
        freePointer: 0xe0,
      };

      const layout: BlockLayout = {
        order: ["entry"],
        offsets: new Map(),
      };

      const bytecode = generateFunction(func, memory, layout);

      // Should get msg.sender
      expect(bytecode).toContain(OPCODES.CALLER);

      // Should compute slot with KECCAK256
      expect(bytecode).toContain(OPCODES.KECCAK256);

      // Should load from storage
      expect(bytecode).toContain(OPCODES.SLOAD);

      // Should have proper memory operations for hash
      const mstores = bytecode.filter((b) => b === OPCODES.MSTORE);
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
          "%sender": 0x80,
          "%index": 0xa0,
          "%userSlot": 0xc0,
          "%arrayBase": 0xe0,
          "%finalSlot": 0x100,
          "%value": 0x120,
        },
        freePointer: 0x140,
      };

      const layout: BlockLayout = {
        order: ["entry"],
        offsets: new Map(),
      };

      const bytecode = generateFunction(func, memory, layout);

      // Should have KECCAK256 operations for both mapping and array
      // Count actual KECCAK256 opcodes (not 0x20 as push data)
      let keccakCount = 0;
      for (let i = 0; i < bytecode.length; i++) {
        if (bytecode[i] === OPCODES.KECCAK256) {
          // Make sure this isn't data for a PUSH instruction
          // PUSH1 through PUSH32 are 0x60-0x7f
          if (i === 0 || bytecode[i - 1] < 0x60 || bytecode[i - 1] > 0x7f) {
            keccakCount++;
          }
        }
      }
      // We expect at least 2 (one for mapping, one for array)
      // There might be more due to memory operations
      expect(keccakCount).toBeGreaterThanOrEqual(2);

      // Should have ADD for index offset
      expect(bytecode).toContain(OPCODES.ADD);

      // Should load from storage
      expect(bytecode).toContain(OPCODES.SLOAD);
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

      // Should have CODECOPY and RETURN opcodes for deployment
      expect(result.create).toContain(OPCODES.CODECOPY);
      expect(result.create).toContain(OPCODES.RETURN);
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

      const bytecode = generateFunction(func, memory, layout);

      // The bytecode should handle the local operations correctly
      // Whether through stack manipulation or memory depends on the implementation

      // Should contain ADD for the increment
      expect(bytecode).toContain(OPCODES.ADD);
    });
  });
});
