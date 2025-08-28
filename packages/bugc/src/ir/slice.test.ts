import { describe, expect, test } from "vitest";
import { parse } from "../parser";
import { TypeChecker } from "../typechecker";
import { IrBuilder } from "../irgen";
import { Severity } from "../result";
import "../../test/matchers";

describe("IR slice generation", () => {
  test("generates slice IR for msg.data", () => {
    const result = parse(`
      name Test;
      code {
        let slice = msg.data[0:4];
      }
    `);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Parse failed");

    const checker = new TypeChecker();
    const typeResult = checker.check(result.value);
    expect(typeResult.success).toBe(true);

    if (typeResult.success) {
      const builder = new IrBuilder();
      const irResult = builder.build(result.value, typeResult.value.types);
      expect(irResult.success).toBe(true);

      if (irResult.success) {
        const ir = irResult.value;
        expect(ir.main).toBeDefined();

        // Find the slice instruction
        const mainBlocks = Array.from(ir.main.blocks.values());
        const sliceInsts = mainBlocks.flatMap((block) =>
          block.instructions.filter((inst) => inst.kind === "slice"),
        );

        expect(sliceInsts).toHaveLength(1);
        const sliceInst = sliceInsts[0];

        expect(sliceInst.kind).toBe("slice");
        if (sliceInst.kind === "slice") {
          // Values could be temp or const depending on evaluation order
          expect(["temp", "env"]).toContain(sliceInst.object.kind);
          expect(["temp", "const"]).toContain(sliceInst.start.kind);
          expect(["temp", "const"]).toContain(sliceInst.end.kind);
        }
      }
    }
  });

  test("rejects slice of non-bytes type in IR", () => {
    const result = parse(`
      name Test;
      storage {
        [0] numbers: array<uint256, 10>;
      }
      code {
        numbers[0:4];
      }
    `);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Parse failed");

    const checker = new TypeChecker();
    const typeResult = checker.check(result.value);

    if (typeResult.success) {
      const builder = new IrBuilder();
      const irResult = builder.build(result.value, typeResult.value.types);
      expect(irResult.success).toBe(false);
      expect(irResult).toHaveMessage({
        severity: Severity.Error,
        message: "Only bytes types can be sliced",
      });
    }
  });
});
