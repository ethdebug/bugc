import { describe, expect, test } from "vitest";
import { parse } from "./index";
import { AccessExpression } from "../ast";

describe("Slice expressions", () => {
  test("parses simple slice syntax", () => {
    const result = parse(`
      name Test;
      code {
        data[0:4];
      }
    `);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Parse failed");
    }
    const program = result.value;
    const exprStmt = program.body.items[0];
    expect(exprStmt.type).toBe("ExpressionStatement");

    if (exprStmt.type === "ExpressionStatement") {
      const slice = exprStmt.expression as AccessExpression;
      expect(slice.type).toBe("AccessExpression");
      expect(slice.kind).toBe("slice");
      expect(slice.property).toMatchObject({
        type: "LiteralExpression",
        value: "0",
      });
      expect(slice.end).toMatchObject({
        type: "LiteralExpression",
        value: "4",
      });
    }
  });

  test("parses slice with complex expressions", () => {
    const result = parse(`
      name Test;
      code {
        msg.data[offset:offset + 32];
      }
    `);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Parse failed");
    const program = result.value;
    const exprStmt = program.body.items[0];

    if (exprStmt.type === "ExpressionStatement") {
      const slice = exprStmt.expression as AccessExpression;
      expect(slice.kind).toBe("slice");
      expect(slice.object).toMatchObject({
        type: "SpecialExpression",
        kind: "msg.data",
      });
    }
  });

  test("distinguishes slice from index access", () => {
    const result = parse(`
      name Test;
      code {
        data[5];
        data[0:5];
      }
    `);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Parse failed");
    const program = result.value;

    const indexedStmt = program.body.items[0];
    const slicedStmt = program.body.items[1];

    if (
      indexedStmt.type === "ExpressionStatement" &&
      slicedStmt.type === "ExpressionStatement"
    ) {
      const indexed = indexedStmt.expression as AccessExpression;
      const sliced = slicedStmt.expression as AccessExpression;

      expect(indexed.kind).toBe("index");
      expect(indexed.end).toBeUndefined();

      expect(sliced.kind).toBe("slice");
      expect(sliced.end).toBeDefined();
    }
  });
});
