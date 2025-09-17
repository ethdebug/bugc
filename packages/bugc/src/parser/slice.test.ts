import { describe, expect, test } from "vitest";

import * as Ast from "#ast";

import { parse } from "./parser.js";

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
    const exprStmt = program.body?.items[0];
    expect(exprStmt?.type).toBe("ExpressionStatement");

    if (exprStmt?.type === "ExpressionStatement") {
      const slice = (exprStmt as Ast.Statement.Express)
        .expression as Ast.Expression.Access;
      if (!Ast.Expression.Access.isSlice(slice)) {
        throw new Error("Expected slice access");
      }

      expect(slice.type).toBe("AccessExpression");
      expect(slice.kind).toBe("slice");
      expect(slice.start).toMatchObject({
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
    const exprStmt = program.body?.items[0];

    if (exprStmt?.type === "ExpressionStatement") {
      const slice = (exprStmt as Ast.Statement.Express)
        .expression as Ast.Expression.Access;
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

    const indexedStmt = program.body?.items[0];
    const slicedStmt = program.body?.items[1];

    if (
      indexedStmt?.type === "ExpressionStatement" &&
      slicedStmt?.type === "ExpressionStatement"
    ) {
      const indexed = (indexedStmt as Ast.Statement.Express)
        .expression as Ast.Expression.Access;
      const sliced = (slicedStmt as Ast.Statement.Express)
        .expression as Ast.Expression.Access;

      expect(indexed.kind).toBe("index");
      expect(sliced.kind).toBe("slice");
    }
  });
});
