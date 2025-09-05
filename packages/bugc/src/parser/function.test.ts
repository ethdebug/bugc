import { describe, it, expect } from "vitest";
import type { ElementaryType } from "#ast";
import { Severity } from "#result";
import { parse } from "./parser.js";
import "#test/matchers";

describe("Function declarations", () => {
  it("parses function with parameters and return type", () => {
    if (!parse) {
      throw new Error("parse function is not imported");
    }
    const input = `
      name FunctionTest;

      define {
        function add(a: uint256, b: uint256) -> uint256 {
          return a + b;
        };
      }

      code {}
    `;

    const result = parse(input);
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Parse failed");
    }

    const program = result.value;
    expect(program.declarations).toHaveLength(1);

    const funcDecl = program.declarations[0];
    expect(funcDecl.kind).toBe("function");
    expect(funcDecl.name).toBe("add");
    expect(funcDecl.metadata?.parameters).toHaveLength(2);
    expect(funcDecl.metadata?.parameters?.[0].name).toBe("a");
    expect(funcDecl.metadata?.parameters?.[1].name).toBe("b");
    expect(funcDecl.declaredType?.type).toBe("ElementaryType");
    expect((funcDecl.declaredType as ElementaryType).kind).toBe("uint");
  });

  it("parses void function without return type", () => {
    const input = `
      name VoidFunction;

      define {
        function doSomething(x: uint256) {
          let y = x + 1;
        };
      }

      code {}
    `;

    const result = parse(input);
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Parse failed");
    }

    const program = result.value;
    const funcDecl = program.declarations[0];
    expect(funcDecl.kind).toBe("function");
    expect(funcDecl.name).toBe("doSomething");
    expect(funcDecl.declaredType).toBeUndefined();
  });

  it("parses function calls", () => {
    const input = `
      name CallTest;

      define {
        function multiply(x: uint256, y: uint256) -> uint256 {
          return x * y;
        };
      }

      code {
        let result = multiply(10, 20);
      }
    `;

    const result = parse(input);
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Parse failed");
    }

    const program = result.value;
    const codeBlock = program.body;
    const letStmt = codeBlock.items[0];

    expect(letStmt.type).toBe("DeclarationStatement");
    if (letStmt.type === "DeclarationStatement") {
      const init = letStmt.declaration.initializer;
      expect(init?.type).toBe("CallExpression");
      if (init?.type === "CallExpression") {
        expect(init.callee.type).toBe("IdentifierExpression");
        if (init.callee.type === "IdentifierExpression") {
          expect(init.callee.name).toBe("multiply");
        }
        expect(init.arguments).toHaveLength(2);
      }
    }
  });

  it("rejects function as identifier", () => {
    const input = `
      name BadIdentifier;
      code {
        let function = 5;
      }
    `;

    const result = parse(input);
    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result).toHaveMessage({
        severity: Severity.Error,
        message: "function",
      });
    }
  });
});
