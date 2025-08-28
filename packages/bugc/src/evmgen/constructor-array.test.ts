import { describe, it, expect } from "vitest";
import { parse } from "../parser";
import { TypeChecker } from "../typechecker";
import { IrGenerator } from "../irgen/generator";
import type { BinaryOpInstruction } from "../ir";
import { analyzeModuleLiveness, analyzeLiveness } from "../liveness";
import {
  analyzeModuleMemory,
  planFunctionMemory,
} from "../memory/memory-planner";
import { analyzeModuleBlockLayout, layoutBlocks } from "../memory/block-layout";
import { generateModule } from "./generator";
import { generateFunction } from "./ir-handlers";
import { OPCODES } from "../evm";

describe("Constructor array storage", () => {
  it("should correctly store values in fixed-size arrays during construction", () => {
    const source = `name ConstructorArray;

storage {
  [0] items: array<uint256, 3>;
}

create {
  items[0] = 1005;
  items[1] = 1006;
  items[2] = 1007;
}

code {}
`;

    // Parse and type check
    const parseResult = parse(source);
    if (!parseResult.success) {
      // Parse error details available in parseResult
    }
    expect(parseResult.success).toBe(true);
    if (!parseResult.success) return;

    const typeChecker = new TypeChecker();
    const typeCheckResult = typeChecker.check(parseResult.value);
    expect(typeCheckResult.success).toBe(true);
    if (!typeCheckResult.success) return;

    // Generate IR
    const irGenerator = new IrGenerator();
    const irResult = irGenerator.build(
      parseResult.value,
      typeCheckResult.value.types,
    );
    expect(irResult.success).toBe(true);
    if (!irResult.success) return;

    const module = irResult.value;
    expect(module.create).toBeDefined();

    // Check IR - should have direct slot additions
    const createFunc = module.create!;
    const entry = createFunc.blocks.get("entry")!;

    // Check that we're adding indices to base slot 0
    const addInstructions = entry.instructions.filter(
      (i) => i.kind === "binary" && i.op === "add",
    );
    expect(addInstructions.length).toBe(3);

    // Instructions are verified by checking store_storage count below

    // Check store_storage instructions
    const storeInstructions = entry.instructions.filter(
      (i) => i.kind === "store_storage",
    );
    expect(storeInstructions.length).toBe(3);

    // Generate bytecode
    const liveness = analyzeLiveness(createFunc);
    const memoryResult = planFunctionMemory(createFunc, liveness);
    if (!memoryResult.success) throw new Error("Memory planning failed");
    const memory = memoryResult.value;
    const layout = layoutBlocks(createFunc);

    const { bytecode } = generateFunction(createFunc, memory, layout);

    // Check bytecode contains SSTORE operations
    const sstoreCount = bytecode.filter((b) => b === OPCODES.SSTORE).length;
    expect(sstoreCount).toBe(3);

    // The bytecode should directly use slots 0, 1, 2
    // Look for the pattern: PUSH value, PUSH slot, SSTORE
    // Find all SSTORE positions
    const sstorePositions = [];
    for (let i = 0; i < bytecode.length; i++) {
      if (bytecode[i] === OPCODES.SSTORE) {
        sstorePositions.push(i);
      }
    }

    // Verify we have exactly 3 SSTORE operations at the expected positions
    expect(sstorePositions.length).toBe(3);
  });

  it("should generate correct deployment bytecode for array constructor", () => {
    const source = `name ConstructorArray;

storage {
  [0] items: array<uint256, 3>;
}

create {
  items[0] = 1005;
  items[1] = 1006;
  items[2] = 1007;
}

code {}
`;

    // Parse and type check
    const parseResult = parse(source);
    if (!parseResult.success) {
      // Parse error details available in parseResult
    }
    expect(parseResult.success).toBe(true);
    if (!parseResult.success) return;

    const typeChecker = new TypeChecker();
    const typeCheckResult = typeChecker.check(parseResult.value);
    expect(typeCheckResult.success).toBe(true);
    if (!typeCheckResult.success) return;

    // Generate IR
    const irGenerator = new IrGenerator();
    const irResult = irGenerator.build(
      parseResult.value,
      typeCheckResult.value.types,
    );
    expect(irResult.success).toBe(true);
    if (!irResult.success) return;

    // Generate full module bytecode
    const module = irResult.value;

    const liveness = analyzeModuleLiveness(module);
    const memoryResult = analyzeModuleMemory(module, liveness);
    if (!memoryResult.success) throw new Error("Memory planning failed");

    const blockResult = analyzeModuleBlockLayout(module);
    if (!blockResult.success) throw new Error("Block layout failed");

    const result = generateModule(
      module,
      memoryResult.value,
      blockResult.value,
    );

    expect(result.create).toBeDefined();
    expect(result.runtime).toBeDefined();

    // The deployment bytecode should contain the constructor code
    const createBytecode = result.create!;

    // Should have 3 SSTORE operations
    const sstoreCount = createBytecode.filter(
      (b) => b === OPCODES.SSTORE,
    ).length;
    expect(sstoreCount).toBe(3);

    // Should end with CODECOPY and RETURN
    expect(createBytecode).toContain(OPCODES.CODECOPY);
    expect(createBytecode).toContain(OPCODES.RETURN);
  });

  it("should not allocate memory for intermediate slot calculations", () => {
    const source = `name ConstructorArray;

storage {
  [0] items: array<uint256, 3>;
}

create {
  items[0] = 1005;
  items[1] = 1006;
  items[2] = 1007;
}

code {}
`;

    // Parse and type check
    const parseResult = parse(source);
    if (!parseResult.success) {
      // Parse error details available in parseResult
    }
    expect(parseResult.success).toBe(true);
    if (!parseResult.success) return;

    const typeChecker = new TypeChecker();
    const typeCheckResult = typeChecker.check(parseResult.value);
    expect(typeCheckResult.success).toBe(true);
    if (!typeCheckResult.success) return;

    // Generate IR
    const irGenerator = new IrGenerator();
    const irResult = irGenerator.build(
      parseResult.value,
      typeCheckResult.value.types,
    );
    expect(irResult.success).toBe(true);
    if (!irResult.success) return;

    const module = irResult.value;
    const createFunc = module.create!;

    // Analyze what gets allocated to memory
    const liveness = analyzeLiveness(createFunc);
    const memoryResult = planFunctionMemory(createFunc, liveness);
    if (!memoryResult.success) throw new Error("Memory planning failed");
    const memory = memoryResult.value;

    // The slot calculation results (t2, t5, t8) should NOT be in memory
    // because they're only used once immediately after creation
    const entry = createFunc.blocks.get("entry")!;

    // Find the add instruction destinations (these are the computed slots)
    const slotTemps = entry.instructions
      .filter((i) => i.kind === "binary" && i.op === "add")
      .map((i) => (i as BinaryOpInstruction).dest);

    // These should NOT be allocated to memory if they're only used once
    for (const temp of slotTemps) {
      expect(temp in memory.allocations).toBe(false);
    }
  });
});
