import { describe, it, expect } from "vitest";
import * as Ir from "#ir";
import { PhiInserter } from "./phi-inserter.js";

describe("PhiInserter", () => {
  it("should insert phi nodes at control flow merge points", () => {
    // Create a simple diamond-shaped CFG that requires a phi node
    const module: Ir.Module = {
      name: "TestModule",
      storage: { slots: [] },
      functions: new Map(),
      main: {
        name: "main",
        parameters: [],
        entry: "entry",
        blocks: new Map([
          [
            "entry",
            {
              id: "entry",
              instructions: [
                {
                  kind: "const",
                  value: 10n,
                  type: { kind: "uint", bits: 256 },
                  dest: "t0",
                },
                {
                  kind: "const",
                  value: 5n,
                  type: { kind: "uint", bits: 256 },
                  dest: "t1",
                },
              ],
              terminator: {
                kind: "branch",
                condition: { kind: "temp", id: "t1", type: { kind: "bool" } },
                trueTarget: "then",
                falseTarget: "else",
              },
              predecessors: new Set(),
              phis: [],
            },
          ],
          [
            "then",
            {
              id: "then",
              instructions: [
                {
                  kind: "const",
                  value: 20n,
                  type: { kind: "uint", bits: 256 },
                  dest: "t2",
                },
              ],
              terminator: {
                kind: "jump",
                target: "merge",
              },
              predecessors: new Set(["entry"]),
              phis: [],
            },
          ],
          [
            "else",
            {
              id: "else",
              instructions: [
                {
                  kind: "const",
                  value: 30n,
                  type: { kind: "uint", bits: 256 },
                  dest: "t3",
                },
              ],
              terminator: {
                kind: "jump",
                target: "merge",
              },
              predecessors: new Set(["entry"]),
              phis: [],
            },
          ],
          [
            "merge",
            {
              id: "merge",
              instructions: [
                // This instruction uses t2 which is only defined in "then" branch
                // A phi node should be inserted for this
                {
                  kind: "binary",
                  op: "add",
                  left: {
                    kind: "temp",
                    id: "t2",
                    type: { kind: "uint", bits: 256 },
                  },
                  right: {
                    kind: "temp",
                    id: "t0",
                    type: { kind: "uint", bits: 256 },
                  },
                  dest: "t4",
                },
              ],
              terminator: {
                kind: "return",
              },
              predecessors: new Set(["then", "else"]),
              phis: [],
            },
          ],
        ]),
      },
    };

    const inserter = new PhiInserter();
    const result = inserter.insertPhiNodes(module);

    // Check that phi nodes were inserted in the merge block
    const mergeBlock = result.main.blocks.get("merge");
    expect(mergeBlock).toBeDefined();
    expect(mergeBlock!.phis.length).toBeGreaterThan(0);

    // Check that there's a phi node for the variable that needs it
    const phiNodes = mergeBlock!.phis;

    // Should have at least one phi node
    expect(phiNodes.length).toBeGreaterThanOrEqual(1);

    // The phi node should have sources from both predecessors
    for (const phi of phiNodes) {
      expect(phi.sources.size).toBe(2);
      expect(phi.sources.has("then")).toBe(true);
      expect(phi.sources.has("else")).toBe(true);
    }
  });

  it("should not insert phi nodes when not needed", () => {
    // Create a linear CFG that doesn't need phi nodes
    const module: Ir.Module = {
      name: "TestModule",
      storage: { slots: [] },
      functions: new Map(),
      main: {
        name: "main",
        parameters: [],
        entry: "entry",
        blocks: new Map([
          [
            "entry",
            {
              id: "entry",
              instructions: [
                {
                  kind: "const",
                  value: 10n,
                  type: { kind: "uint", bits: 256 },
                  dest: "t0",
                },
              ],
              terminator: {
                kind: "jump",
                target: "next",
              },
              predecessors: new Set(),
              phis: [],
            },
          ],
          [
            "next",
            {
              id: "next",
              instructions: [
                {
                  kind: "binary",
                  op: "add",
                  left: {
                    kind: "temp",
                    id: "t0",
                    type: { kind: "uint", bits: 256 },
                  },
                  right: {
                    kind: "const",
                    value: 1n,
                    type: { kind: "uint", bits: 256 },
                  },
                  dest: "t1",
                },
              ],
              terminator: {
                kind: "return",
              },
              predecessors: new Set(["entry"]),
              phis: [],
            },
          ],
        ]),
      },
    };

    const inserter = new PhiInserter();
    const result = inserter.insertPhiNodes(module);

    // Check that no phi nodes were inserted in blocks with single predecessors
    const nextBlock = result.main.blocks.get("next");
    expect(nextBlock).toBeDefined();
    expect(nextBlock!.phis.length).toBe(0);
  });

  it("should insert phi nodes with correct types", () => {
    // Create a CFG with different types
    const module: Ir.Module = {
      name: "TestModule",
      storage: { slots: [] },
      functions: new Map(),
      main: {
        name: "main",
        parameters: [],
        entry: "entry",
        blocks: new Map([
          [
            "entry",
            {
              id: "entry",
              instructions: [
                {
                  kind: "const",
                  value: true,
                  type: { kind: "bool" },
                  dest: "t0",
                },
              ],
              terminator: {
                kind: "branch",
                condition: { kind: "temp", id: "t0", type: { kind: "bool" } },
                trueTarget: "then",
                falseTarget: "else",
              },
              predecessors: new Set(),
              phis: [],
            },
          ],
          [
            "then",
            {
              id: "then",
              instructions: [
                {
                  kind: "const",
                  value: "0x1234",
                  type: { kind: "address" },
                  dest: "t1",
                },
              ],
              terminator: {
                kind: "jump",
                target: "merge",
              },
              predecessors: new Set(["entry"]),
              phis: [],
            },
          ],
          [
            "else",
            {
              id: "else",
              instructions: [
                {
                  kind: "const",
                  value: "0x5678",
                  type: { kind: "address" },
                  dest: "t2",
                },
              ],
              terminator: {
                kind: "jump",
                target: "merge",
              },
              predecessors: new Set(["entry"]),
              phis: [],
            },
          ],
          [
            "merge",
            {
              id: "merge",
              instructions: [
                // Use t1 which is only defined in "then"
                {
                  kind: "store_storage",
                  slot: {
                    kind: "const",
                    value: 0n,
                    type: { kind: "uint", bits: 256 },
                  },
                  value: { kind: "temp", id: "t1", type: { kind: "address" } },
                },
              ],
              terminator: {
                kind: "return",
              },
              predecessors: new Set(["then", "else"]),
              phis: [],
            },
          ],
        ]),
      },
    };

    const inserter = new PhiInserter();
    const result = inserter.insertPhiNodes(module);

    const mergeBlock = result.main.blocks.get("merge");
    expect(mergeBlock).toBeDefined();

    // Should have phi nodes
    const phiNodes = mergeBlock!.phis;
    expect(phiNodes.length).toBeGreaterThan(0);

    // Check that phi nodes have the correct type
    for (const phi of phiNodes) {
      if (phi.dest === "t1" || phi.dest === "t2") {
        expect(phi.type).toEqual({ kind: "address" });
      }
    }
  });
});
