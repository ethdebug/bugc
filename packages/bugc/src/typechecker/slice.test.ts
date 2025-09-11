import { describe, expect, test } from "vitest";

import * as Ast from "#ast";
import { parse } from "#parser";
import { Severity } from "#result";

import { checkProgram } from "./checker.js";

import "#test/matchers";

describe("Slice type checking", () => {
  test("validates slice of msg.data", () => {
    const result = parse(`
      name Test;
      code {
        let slice = msg.data[0:4];
      }
    `);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Parse failed");

    const typeResult = checkProgram(result.value);
    expect(typeResult.success).toBe(true);

    if (typeResult.success) {
      const types = typeResult.value;
      const program = result.value;
      const decl = program.body?.items[0];
      if (decl?.type === "DeclarationStatement") {
        const varDecl = decl.declaration as Ast.Declaration.Variable;
        const sliceType = types.get(varDecl.initializer?.id!);
        expect(sliceType?.toString()).toBe("bytes");
      }
    }
  });

  test("rejects slice of non-bytes type", () => {
    const result = parse(`
      name Test;
      storage {
        [0] numbers: array<uint256, 10>;
      }
      code {
        let slice = numbers[0:4];
      }
    `);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Parse failed");

    const typeResult = checkProgram(result.value);
    expect(typeResult.success).toBe(false);
    expect(typeResult).toHaveMessage({
      severity: Severity.Error,
      message: "Cannot slice",
    });
  });

  test("validates slice indices are numeric", () => {
    const result = parse(`
      name Test;
      code {
        let slice = msg.data["start":"end"];
      }
    `);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Parse failed");

    const typeResult = checkProgram(result.value);
    expect(typeResult.success).toBe(false);
    expect(typeResult).toHaveMessage({
      severity: Severity.Error,
      message: "Slice start index must be numeric",
    });
    expect(typeResult).toHaveMessage({
      severity: Severity.Error,
      message: "Slice end index must be numeric",
    });
  });
});
