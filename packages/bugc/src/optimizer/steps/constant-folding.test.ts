import { describe, it, expect } from "vitest";

import { IrModule, BasicBlock, IrInstruction } from "#ir";

import { ConstantFoldingStep } from "./constant-folding.js";
import { OptimizationContext } from "../optimizer.js";

describe("ConstantFoldingStep", () => {
  const step = new ConstantFoldingStep();

  function createTestModule(instructions: IrInstruction[]): IrModule {
    const block: BasicBlock = {
      id: "entry",
      phis: [],
      instructions,
      terminator: { kind: "return" },
      predecessors: new Set<string>(),
    };

    return {
      name: "test",
      storage: { slots: [] },
      functions: new Map(),
      main: {
        name: "main",
        locals: [],
        entry: "entry",
        blocks: new Map([["entry", block]]),
      },
    };
  }

  it("should fold keccak256 on string constants", () => {
    const module = createTestModule([
      {
        kind: "const",
        value: "transfer(address,uint256)",
        type: { kind: "string" },
        dest: "t0",
      },
      {
        kind: "hash",
        value: { kind: "temp", id: "t0", type: { kind: "string" } },
        dest: "t1",
      },
    ]);

    const context: OptimizationContext = {
      trackTransformation: () => {},
      getTransformations: () => [],
      getAnalysis: () => undefined,
      setAnalysis: () => {},
    };

    const optimized = step.run(module, context);
    const block = optimized.main.blocks.get("entry")!;

    expect(block.instructions).toHaveLength(2);
    expect(block.instructions[1]).toMatchObject({
      kind: "const",
      // This is keccak256("transfer(address,uint256)")
      value:
        76450787364331811106618268332334209071204572358820727073668507032443496760475n,
      type: { kind: "bytes", size: 32 },
      dest: "t1",
    });
  });

  it("should not fold keccak256 on non-constant values", () => {
    const module = createTestModule([
      {
        kind: "load_local",
        local: "input",
        dest: "t0",
      },
      {
        kind: "hash",
        value: { kind: "temp", id: "t0", type: { kind: "string" } },
        dest: "t1",
      },
    ]);

    const context: OptimizationContext = {
      trackTransformation: () => {},
      getTransformations: () => [],
      getAnalysis: () => undefined,
      setAnalysis: () => {},
    };

    const optimized = step.run(module, context);
    const block = optimized.main.blocks.get("entry")!;

    expect(block.instructions).toHaveLength(2);
    expect(block.instructions[1]).toMatchObject({
      kind: "hash",
      value: { kind: "temp", id: "t0" },
      dest: "t1",
    });
  });

  it("should fold multiple hash operations", () => {
    const module = createTestModule([
      {
        kind: "const",
        value: "pause()",
        type: { kind: "string" },
        dest: "t0",
      },
      {
        kind: "hash",
        value: { kind: "temp", id: "t0", type: { kind: "string" } },
        dest: "t1",
      },
      {
        kind: "const",
        value: "unpause()",
        type: { kind: "string" },
        dest: "t2",
      },
      {
        kind: "hash",
        value: { kind: "temp", id: "t2", type: { kind: "string" } },
        dest: "t3",
      },
    ]);

    const context: OptimizationContext = {
      trackTransformation: () => {},
      getTransformations: () => [],
      getAnalysis: () => undefined,
      setAnalysis: () => {},
    };

    const optimized = step.run(module, context);
    const block = optimized.main.blocks.get("entry")!;

    expect(block.instructions).toHaveLength(4);

    // Check that both hash instructions were folded
    expect(block.instructions[1]).toMatchObject({
      kind: "const",
      type: { kind: "bytes", size: 32 },
      dest: "t1",
    });

    expect(block.instructions[3]).toMatchObject({
      kind: "const",
      type: { kind: "bytes", size: 32 },
      dest: "t3",
    });
  });
});
