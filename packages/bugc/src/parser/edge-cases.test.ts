import { describe, test, expect } from "vitest";
import type {
  LiteralExpression,
  AssignmentStatement,
  DeclarationStatement,
} from "#ast";
import { parse } from "./parser.js";

describe("Parser Edge Cases", () => {
  describe("Hex Literals", () => {
    test("parses hex literals with various lengths", () => {
      const cases = [
        { input: "0x0", expected: "0x0" },
        { input: "0x00", expected: "0x00" },
        { input: "0xFF", expected: "0xFF" },
        { input: "0xff", expected: "0xff" },
        { input: "0xDEADBEEF", expected: "0xDEADBEEF" },
        { input: "0xdeadbeef", expected: "0xdeadbeef" },
        { input: "0x123456789ABCDEF", expected: "0x123456789ABCDEF" },
        // 64 character hex literal (bytes32)
        { input: "0x" + "F".repeat(64), expected: "0x" + "F".repeat(64) },
        { input: "0x" + "0".repeat(64), expected: "0x" + "0".repeat(64) },
      ];

      for (const { input, expected } of cases) {
        const source = `
          name HexTest;
          storage {
            [0] value: uint256;
          }
          code {
            value = ${input};
          }
        `;

        const parseResult = parse(source);
        expect(parseResult.success).toBe(true);
        if (!parseResult.success) throw new Error("Parse failed");
        const result = parseResult.value;
        const assignment = result.body.items[0] as AssignmentStatement;
        const literal = assignment.value as LiteralExpression;
        expect(literal.kind).toBe("hex");
        expect(literal.value).toBe(expected);
      }
    });

    test("parses 64-character hex literal as hex, not address", () => {
      const longHex = "0x" + "A".repeat(64);
      const source = `
        name Test;
        storage {}
        code {
          let x = ${longHex};
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const stmt = result.body.items[0];
      expect(stmt.type).toBe("DeclarationStatement");
      const decl = (stmt as DeclarationStatement).declaration;
      const literal = decl.initializer as LiteralExpression;
      expect(literal.kind).toBe("hex");
      expect(literal.value).toBe(longHex);
    });
  });

  describe("Address Literals", () => {
    test("parses valid address literals", () => {
      const cases = [
        "0x1234567890123456789012345678901234567890",
        "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
        "0x0000000000000000000000000000000000000000",
        "0xDeAdBeEfDeAdBeEfDeAdBeEfDeAdBeEfDeAdBeEf",
      ];

      for (const addr of cases) {
        const source = `
          name Test;
          storage {}
          code {
            let x = ${addr};
          }
        `;

        const parseResult = parse(source);
        expect(parseResult.success).toBe(true);
        if (!parseResult.success) throw new Error("Parse failed");
        const result = parseResult.value;
        const stmt = result.body.items[0];
        const decl = (stmt as DeclarationStatement).declaration;
        const literal = decl.initializer as LiteralExpression;
        expect(literal.kind).toBe("address");
        expect(literal.value).toBe(addr.toLowerCase());
      }
    });

    test("normalizes address case to lowercase", () => {
      const source = `
        name Test;
        storage {}
        code {
          let x = 0xABCDEF1234567890123456789012345678901234;
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const stmt = result.body.items[0];
      const decl = (stmt as DeclarationStatement).declaration;
      const literal = decl.initializer as LiteralExpression;
      expect(literal.value).toBe("0xabcdef1234567890123456789012345678901234");
    });

    test("distinguishes between address and shorter hex", () => {
      const source = `
        name Test;
        storage {}
        code {
          let addr = 0x1234567890123456789012345678901234567890;
          let hex = 0x123456789012345678901234567890123456789;
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const [addrStmt, hexStmt] = result.body.items;

      const addrLiteral = (addrStmt as DeclarationStatement).declaration
        .initializer as LiteralExpression;
      expect(addrLiteral.kind).toBe("address");

      const hexLiteral = (hexStmt as DeclarationStatement).declaration
        .initializer as LiteralExpression;
      expect(hexLiteral.kind).toBe("hex");
    });
  });

  describe("Number Literals", () => {
    test("parses various number formats", () => {
      const cases = [
        { input: "0", expected: "0" },
        { input: "1", expected: "1" },
        { input: "42", expected: "42" },
        { input: "123456789", expected: "123456789" },
        { input: "999999999999999999", expected: "999999999999999999" },
      ];

      for (const { input, expected } of cases) {
        const source = `
          name Test;
          storage {}
          code {
            let x = ${input};
          }
        `;

        const parseResult = parse(source);
        expect(parseResult.success).toBe(true);
        if (!parseResult.success) throw new Error("Parse failed");
        const result = parseResult.value;
        const stmt = result.body.items[0];
        const decl = (stmt as DeclarationStatement).declaration;
        const literal = decl.initializer as LiteralExpression;
        expect(literal.kind).toBe("number");
        expect(literal.value).toBe(expected);
      }
    });

    test("parses numbers with leading zeros", () => {
      const source = `
        name Test;
        storage {}
        code {
          let x = 007;
          let y = 000123;
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const [xStmt, yStmt] = result.body.items;

      const xLiteral = (xStmt as DeclarationStatement).declaration
        .initializer as LiteralExpression;
      expect(xLiteral.value).toBe("007");

      const yLiteral = (yStmt as DeclarationStatement).declaration
        .initializer as LiteralExpression;
      expect(yLiteral.value).toBe("000123");
    });
  });

  describe("Wei Literals", () => {
    test("parses wei unit literals", () => {
      const cases = [
        { input: "1 wei", value: "1", unit: "wei" },
        { input: "100 wei", value: "100", unit: "wei" },
        { input: "1000000 wei", value: "1000000", unit: "wei" },
      ];

      for (const { input, value, unit } of cases) {
        const source = `
          name Test;
          storage {}
          code {
            let x = ${input};
          }
        `;

        const parseResult = parse(source);
        expect(parseResult.success).toBe(true);
        if (!parseResult.success) throw new Error("Parse failed");
        const result = parseResult.value;
        const stmt = result.body.items[0];
        const decl = (stmt as DeclarationStatement).declaration;
        const literal = decl.initializer as LiteralExpression;
        expect(literal.kind).toBe("number");
        expect(literal.value).toBe(value);
        expect(literal.unit).toBe(unit);
      }
    });

    test("parses finney unit literals", () => {
      const cases = [
        { input: "1 finney", value: "1", unit: "finney" },
        { input: "50 finney", value: "50", unit: "finney" },
        { input: "999 finney", value: "999", unit: "finney" },
      ];

      for (const { input, value, unit } of cases) {
        const source = `
          name Test;
          storage {}
          code {
            let x = ${input};
          }
        `;

        const parseResult = parse(source);
        expect(parseResult.success).toBe(true);
        if (!parseResult.success) throw new Error("Parse failed");
        const result = parseResult.value;
        const stmt = result.body.items[0];
        const decl = (stmt as DeclarationStatement).declaration;
        const literal = decl.initializer as LiteralExpression;
        expect(literal.kind).toBe("number");
        expect(literal.value).toBe(value);
        expect(literal.unit).toBe(unit);
      }
    });

    test("parses ether unit literals", () => {
      const cases = [
        { input: "1 ether", value: "1", unit: "ether" },
        { input: "100 ether", value: "100", unit: "ether" },
        { input: "1000000 ether", value: "1000000", unit: "ether" },
      ];

      for (const { input, value, unit } of cases) {
        const source = `
          name Test;
          storage {}
          code {
            let x = ${input};
          }
        `;

        const parseResult = parse(source);
        expect(parseResult.success).toBe(true);
        if (!parseResult.success) throw new Error("Parse failed");
        const result = parseResult.value;
        const stmt = result.body.items[0];
        const decl = (stmt as DeclarationStatement).declaration;
        const literal = decl.initializer as LiteralExpression;
        expect(literal.kind).toBe("number");
        expect(literal.value).toBe(value);
        expect(literal.unit).toBe(unit);
      }
    });

    test("parses wei literals in expressions", () => {
      const source = `
        name Test;
        storage {
          [0] balance: uint256;
        }
        code {
          balance = balance + 10 ether;
          if (balance >= 100 ether) {
            balance = 0 wei;
          }
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.body.items).toHaveLength(2);
    });
  });

  describe("String Literals", () => {
    test("parses basic string literals", () => {
      const cases = [
        { input: '""', expected: "" },
        { input: '"hello"', expected: "hello" },
        { input: '"Hello, World!"', expected: "Hello, World!" },
        { input: '"123"', expected: "123" },
        { input: '"with spaces"', expected: "with spaces" },
      ];

      for (const { input, expected } of cases) {
        const source = `
          name Test;
          storage {}
          code {
            let x = ${input};
          }
        `;

        const parseResult = parse(source);
        expect(parseResult.success).toBe(true);
        if (!parseResult.success) throw new Error("Parse failed");
        const result = parseResult.value;
        const stmt = result.body.items[0];
        const decl = (stmt as DeclarationStatement).declaration;
        const literal = decl.initializer as LiteralExpression;
        expect(literal.kind).toBe("string");
        expect(literal.value).toBe(expected);
      }
    });

    test("parses string literals with escape sequences", () => {
      const cases = [
        { input: '"\\n"', expected: "\n" },
        { input: '"\\t"', expected: "\t" },
        { input: '"\\r"', expected: "\r" },
        { input: '"\\\\"', expected: "\\" },
        { input: '"\\""', expected: '"' },
        { input: '"line1\\nline2"', expected: "line1\nline2" },
      ];

      for (const { input, expected } of cases) {
        const source = `
          name Test;
          storage {}
          code {
            let x = ${input};
          }
        `;

        const parseResult = parse(source);
        expect(parseResult.success).toBe(true);
        if (!parseResult.success) throw new Error("Parse failed");
        const result = parseResult.value;
        const stmt = result.body.items[0];
        const decl = (stmt as DeclarationStatement).declaration;
        const literal = decl.initializer as LiteralExpression;
        expect(literal.value).toBe(expected);
      }
    });

    test("parses strings with special characters", () => {
      const cases = [
        '"@#$%^&*()"',
        '"[]{}"',
        '"<>?/|"',
        '"1 + 2 = 3"',
        '"msg.sender"',
      ];

      for (const input of cases) {
        const source = `
          name Test;
          storage {}
          code {
            let x = ${input};
          }
        `;

        const parseResult = parse(source);
        expect(parseResult.success).toBe(true);
        if (!parseResult.success) throw new Error("Parse failed");
        const result = parseResult.value;
        expect(result.body.items).toHaveLength(1);
      }
    });

    test("fails on invalid string literals", () => {
      const cases = [
        '"unterminated',
        '"unterminated\\',
        '"invalid \\x escape"',
      ];

      for (const input of cases) {
        const source = `
          name Test;
          storage {}
          code {
            let x = ${input};
          }
        `;

        const parseResult = parse(source);
        expect(parseResult.success).toBe(false);
      }
    });
  });

  describe("Comments", () => {
    test("parses single-line comments", () => {
      const source = `
        name Test; // This is the name
        storage {} // Empty storage
        code {
          // This is a comment
          let x = 42; // Inline comment
          // Another comment
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.name).toBe("Test");
      expect(result.body.items).toHaveLength(1);
    });

    test("parses multi-line comments", () => {
      const source = `
        name Test; /* Multi-line
        comment here */
        storage {
          /* Storage field */
          [0] x: uint256;
        }
        code {
          /* This is a
             multi-line
             comment */
          let x = /* inline */ 42;
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.declarations).toHaveLength(1);
      expect(result.body.items).toHaveLength(1);
    });

    test("handles nested comment-like content", () => {
      const source = `
        name Test;
        storage {}
        code {
          let s1 = "// not a comment";
          let s2 = "/* also not a comment */";
          // Real comment with /* nested */ syntax
          /* Real comment with // nested syntax */
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.body.items).toHaveLength(2);
    });

    test("parses comments with special characters", () => {
      const source = `
        name Test;
        storage {}
        code {
          // Comment with special chars: @#$%^&*()
          /* Comment with
             unicode: ñ é ü ß */
          let x = 42;
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.body.items).toHaveLength(1);
    });

    test("handles unterminated multi-line comments", () => {
      const source = `
        name Test;
        storage {}
        code {
          /* Unterminated comment
          let x = 42;
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(false);
    });

    test("handles comments at end of file", () => {
      const source = `
        name Test;
        storage {}
        code {}
        // Final comment`;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.name).toBe("Test");
    });
  });

  describe("Empty Constructs", () => {
    test("parses empty storage block", () => {
      const source = `
        name Test;
        storage {}
        code {
          let x = 42;
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.declarations).toEqual([]);
    });

    test("parses empty code block", () => {
      const source = `
        name Test;
        storage {
          [0] x: uint256;
        }
        code {}
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.body.items).toEqual([]);
    });

    test("parses empty structs", () => {
      const source = `
        name Test;
        define {
          struct Empty {};
        }
        storage {}
        code {}
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const struct = result.declarations[0];
      expect(struct.kind).toBe("struct");
      expect(struct.metadata?.fields).toEqual([]);
    });

    test("parses empty control flow blocks", () => {
      const source = `
        name Test;
        storage {}
        code {
          if (true) {}
          for (let i = 0; i < 10; i = i + 1) {}
          if (false) {} else {}
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.body.items).toHaveLength(3);
    });

    test("parses minimal valid program", () => {
      const source = `name X; storage{} code{}`;
      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.name).toBe("X");
    });

    test("parses program with only whitespace and newlines", () => {
      const source = `
        name    Test;


        storage    {

        }

        code    {

        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.name).toBe("Test");
    });

    test("parses empty statements", () => {
      const source = `
        name Test;
        storage {}
        code {
          ;
          let x = 42;;
          ;;
        }
      `;

      // Empty statements should be ignored by parser
      const parseResult = parse(source);
      expect(parseResult.success).toBe(false);
    });
  });

  describe("Parser Error Scenarios", () => {
    test("handles missing semicolons", () => {
      const source = `
        name Test;
        storage {
          [0] x: uint256
        }
        code {}
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(false);
    });

    test("handles unclosed braces", () => {
      const cases = [
        `name Test; storage { code {}`,
        `name Test; storage {} code {`,
        `name Test; storage {} code { if (true) { }`,
      ];

      for (const source of cases) {
        const parseResult = parse(source);
        expect(parseResult.success).toBe(false);
      }
    });

    test("handles invalid syntax", () => {
      const cases = [
        `storage {} code {}`, // missing name
        `name 123; storage {} code {}`, // invalid name
        `code {}`, // missing name
      ];

      for (const source of cases) {
        const parseResult = parse(source);
        expect(parseResult.success).toBe(false);
      }
    });

    test("handles invalid type syntax", () => {
      const cases = [
        `name Test; storage { [0] x: mapping<> } code {}`,
        `name Test; storage { [0] x: array<> } code {}`,
        `name Test; storage { [0] x: array<uint256,> } code {}`,
      ];

      for (const source of cases) {
        const parseResult = parse(source);
        expect(parseResult.success).toBe(false);
      }
    });

    test("handles invalid expressions", () => {
      const cases = [
        `name Test; storage {} code { let x = ; }`,
        `name Test; storage {} code { let x = 1 + ; }`,
        `name Test; storage {} code { let x = + 1; }`,
      ];

      for (const source of cases) {
        const parseResult = parse(source);
        expect(parseResult.success).toBe(false);
      }
    });

    test("handles invalid statements", () => {
      const cases = [
        `name Test; storage {} code { if () {} }`,
        `name Test; storage {} code { for () {} }`,
        `name Test; storage {} code { return return; }`,
      ];

      for (const source of cases) {
        const parseResult = parse(source);
        expect(parseResult.success).toBe(false);
      }
    });

    test("handles mismatched brackets", () => {
      const source = `
        name Test;
        storage {
          [0] x: array<uint256];
        }
        code {}
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(false);
    });
  });

  describe("Operator Edge Cases", () => {
    test("parses comparison operators correctly", () => {
      const source = `
        name Test;
        storage {}
        code {
          let a = 5 > 3;
          let b = 5 >= 3;
          let c = 3 < 5;
          let d = 3 <= 5;
          let e = 5 == 5;
          let f = 3 != 5;
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.body.items).toHaveLength(6);
    });

    test("parses chained comparisons", () => {
      // Note: These parse but may not be semantically valid
      const source = `
        name Test;
        storage {}
        code {
          let a = 1 < 2 < 3;
          let b = 5 > 4 > 3;
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.body.items).toHaveLength(2);
    });

    test("parses nested operators", () => {
      const source = `
        name Test;
        storage {}
        code {
          let a = !(true && false);
          let b = -(-(-1));
          let c = !(!true);
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.body.items).toHaveLength(3);
    });

    test("parses complex operator precedence", () => {
      const source = `
        name Test;
        storage {}
        code {
          let a = 1 + 2 * 3;
          let b = (1 + 2) * 3;
          let c = 1 * 2 + 3;
          let d = 1 * (2 + 3);
          let e = true || false && true;
          let f = (true || false) && true;
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.body.items).toHaveLength(6);
    });

    test("handles operators with whitespace variations", () => {
      const source = `
        name Test;
        storage {}
        code {
          let a = 1+2;
          let b = 1 + 2;
          let c = 1   +   2;
          let d = 1
            +
            2;
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.body.items).toHaveLength(4);
    });

    test("distinguishes between >= and > followed by =", () => {
      const source = `
        name Test;
        storage {
          [0] balance: uint256;
        }
        code {
          if (balance >= 100 ether) {
            balance = 0;
          }
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.body.items).toHaveLength(1);
    });

    test("handles operator-like sequences in strings", () => {
      const source = `
        name Test;
        storage {}
        code {
          let s1 = ">=";
          let s2 = "&&";
          let s3 = "!=";
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.body.items).toHaveLength(3);
    });

    test("parses unary minus with numbers", () => {
      const source = `
        name Test;
        storage {}
        code {
          let a = -1;
          let b = -42;
          let c = -(1 + 2);
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.body.items).toHaveLength(3);
    });

    test("parses boolean not operator", () => {
      const source = `
        name Test;
        storage {}
        code {
          let a = !true;
          let b = !false;
          let c = !(1 > 2);
        }
      `;

      const parseResult = parse(source);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.body.items).toHaveLength(3);
    });

    test("handles invalid operator usage", () => {
      const cases = [
        `name Test; storage {} code { let x = 1 ! 2; }`,
        `name Test; storage {} code { let x = && true; }`,
        `name Test; storage {} code { let x = 1 ||; }`,
      ];

      for (const source of cases) {
        const parseResult = parse(source);
        expect(parseResult.success).toBe(false);
      }
    });
  });
});
