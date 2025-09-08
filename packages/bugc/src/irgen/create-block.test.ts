import { describe, it, expect } from "vitest";
import { parse } from "#parser";
import * as TypeChecker from "#typechecker";
import { IrBuilder } from "#irgen";

describe("IR generation for create blocks", () => {
  it("generates separate IR for create and main functions", () => {
    const code = `
      name Token;

      storage {
        [0] totalSupply: uint256;
        [1] owner: address;
      }

      create {
        totalSupply = 1000000;
        owner = msg.sender;
      }

      code {
        let supply = totalSupply;
      }
    `;

    const parseResult = parse(code);
    expect(parseResult.success).toBe(true);
    if (!parseResult.success) return;

    const typeResult = TypeChecker.checkProgram(parseResult.value);
    expect(typeResult.success).toBe(true);
    if (!typeResult.success) return;

    const irBuilder = new IrBuilder();
    const irResult = irBuilder.build(parseResult.value, typeResult.value.types);
    expect(irResult.success).toBe(true);
    if (!irResult.success) return;

    const module = irResult.value;

    // Check that both functions exist
    expect(module.create).toBeDefined();
    expect(module.main).toBeDefined();

    // Check create function
    expect(module.create!.name).toBe("create");
    expect(module.create!.blocks.size).toBeGreaterThan(0);

    const createEntry = module.create!.blocks.get("entry");
    expect(createEntry).toBeDefined();
    expect(createEntry!.instructions.length).toBeGreaterThan(0);

    // Should have store_storage instructions for totalSupply and owner
    const storeInstructions = createEntry!.instructions.filter(
      (inst) => inst.kind === "store_storage",
    );
    expect(storeInstructions).toHaveLength(2);

    // Check main function
    expect(module.main.name).toBe("main");
    const mainEntry = module.main.blocks.get("entry");
    expect(mainEntry).toBeDefined();

    // Should have load_storage for totalSupply
    const loadInstructions = mainEntry!.instructions.filter(
      (inst) => inst.kind === "load_storage",
    );
    expect(loadInstructions).toHaveLength(1);
  });

  it("handles empty create block", () => {
    const code = `
      name EmptyCreate;

      create {
        // No initialization
      }

      code {
        let x = 42;
      }
    `;

    const parseResult = parse(code);
    expect(parseResult.success).toBe(true);
    if (!parseResult.success) return;

    const typeResult = TypeChecker.checkProgram(parseResult.value);
    expect(typeResult.success).toBe(true);
    if (!typeResult.success) return;

    const irBuilder = new IrBuilder();
    const irResult = irBuilder.build(parseResult.value, typeResult.value.types);
    expect(irResult.success).toBe(true);
    if (!irResult.success) return;

    const module = irResult.value;

    // Empty create block doesn't generate a create function
    expect(module.create).toBeUndefined();
  });

  it("handles control flow in create block", () => {
    const code = `
      name ControlFlowCreate;

      storage {
        [0] initialized: bool;
        [1] value: uint256;
      }

      create {
        if (msg.value > 0) {
          value = msg.value;
          initialized = true;
        } else {
          value = 1000;
          initialized = false;
        }
      }

      code {
        let v = value;
      }
    `;

    const parseResult = parse(code);
    expect(parseResult.success).toBe(true);
    if (!parseResult.success) return;

    const typeResult = TypeChecker.checkProgram(parseResult.value);
    expect(typeResult.success).toBe(true);
    if (!typeResult.success) return;

    const irBuilder = new IrBuilder();
    const irResult = irBuilder.build(parseResult.value, typeResult.value.types);
    expect(irResult.success).toBe(true);
    if (!irResult.success) return;

    const module = irResult.value;

    // Create function should have multiple blocks for if/else
    expect(module.create!.blocks.size).toBeGreaterThan(1);

    // Should have conditional branch
    const entryBlock = module.create!.blocks.get("entry")!;
    expect(entryBlock.terminator.kind).toBe("branch");
  });

  it("maintains separate local variables for create and main", () => {
    const code = `
      name SeparateLocals;

      create {
        let x = 100;
        let y = 200;
      }

      code {
        let x = 300;  // Different x than in create
        let z = 400;
      }
    `;

    const parseResult = parse(code);
    expect(parseResult.success).toBe(true);
    if (!parseResult.success) return;

    const typeResult = TypeChecker.checkProgram(parseResult.value);
    expect(typeResult.success).toBe(true);
    if (!typeResult.success) return;

    const irBuilder = new IrBuilder();
    const irResult = irBuilder.build(parseResult.value, typeResult.value.types);
    expect(irResult.success).toBe(true);
    if (!irResult.success) return;

    const module = irResult.value;

    // Create function should have its own locals
    expect(module.create!.locals).toHaveLength(2);
    const createLocalIds = module.create!.locals.map((l) => l.id);
    expect(createLocalIds.some((id) => id.includes("x"))).toBe(true);
    expect(createLocalIds.some((id) => id.includes("y"))).toBe(true);

    // Main function should have its own locals
    expect(module.main.locals).toHaveLength(2);
    const mainLocalIds = module.main.locals.map((l) => l.id);
    expect(mainLocalIds.some((id) => id.includes("x"))).toBe(true);
    expect(mainLocalIds.some((id) => id.includes("z"))).toBe(true);
  });
});
