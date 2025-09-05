import { describe, it, expect } from "vitest";
import "#test/matchers";
import * as Ast from "#ast";
import { Severity } from "#result";
import { parse } from "./parser.js";

describe("Normalized Parser", () => {
  describe("Basic Parsing", () => {
    it("should parse minimal program", () => {
      const input = `
        name Test;
        storage {}
        code {}
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.type).toBe("Program");
      expect(result.name).toBe("Test");
      expect(result.declarations).toEqual([]);
      expect(result.body.type).toBe("Block");
      expect(result.body.kind).toBe("program");
      expect(result.body.items).toEqual([]);
    });

    it("should set parent references", () => {
      const input = `
        name Test;
        storage {}
        code {
          let x = 42;
        }
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.parent).toBeUndefined();
      expect(result.body.parent).toBeDefined();
      expect(result.body.parent?.type).toBe("Program");
      expect((result.body.parent as Ast.Program).name).toBe("Test");

      const stmt = result.body.items[0];
      expect(stmt.parent).toBe(result.body);
    });

    it("should include source locations", () => {
      const input = `name Test;
storage {}
code {}`;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.loc).not.toBeNull();
      expect(result.loc?.offset).toBe(0);
      expect(result.loc?.length).toBe(input.length);
    });

    it("should parse program without storage block", () => {
      const input = `
        name NoStorage;
        code {
          let x = 10;
        }
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      expect(result.type).toBe("Program");
      expect(result.name).toBe("NoStorage");
      expect(result.declarations).toEqual([]);
      expect(result.body.items).toHaveLength(1);
    });
  });

  describe("Type Parsing", () => {
    it("should parse primitive types", () => {
      const input = `
        name Test;
        storage {
          [0] balance: uint256;
          [1] owner: address;
          [2] flag: bool;
        }
        code {}
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const [balance, owner, flag] = result.declarations;

      expect(balance.declaredType?.type).toBe("ElementaryType");
      const balanceType = balance.declaredType as Ast.ElementaryType;
      expect(balanceType.kind).toBe("uint");
      expect(balanceType.bits).toBe(256);

      const ownerType = owner.declaredType as Ast.ElementaryType;
      expect(ownerType.kind).toBe("address");

      const flagType = flag.declaredType as Ast.ElementaryType;
      expect(flagType.kind).toBe("bool");
    });

    it("should parse array types", () => {
      const input = `
        name Test;
        storage {
          [0] nums: array<uint256>;
          [1] fixed: array<uint256, 10>;
        }
        code {}
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const [nums, fixed] = result.declarations;

      expect(nums.declaredType?.type).toBe("ComplexType");
      const numsType = nums.declaredType as Ast.ComplexType;
      expect(numsType.kind).toBe("array");
      expect(numsType.size).toBeUndefined();
      expect(numsType.typeArgs).toHaveLength(1);

      const fixedType = fixed.declaredType as Ast.ComplexType;
      expect(fixedType.kind).toBe("array");
      expect(fixedType.size).toBe(10);
    });

    it("should parse mapping types", () => {
      const input = `
        name Test;
        storage {
          [0] balances: mapping<address, uint256>;
        }
        code {}
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const mapping = result.declarations[0];

      const mapType = mapping.declaredType as Ast.ComplexType;
      expect(mapType.type).toBe("ComplexType");
      expect(mapType.kind).toBe("mapping");
      expect(mapType.typeArgs).toHaveLength(2);

      const keyType = mapType.typeArgs![0] as Ast.ElementaryType;
      expect(keyType.kind).toBe("address");

      const valueType = mapType.typeArgs![1] as Ast.ElementaryType;
      expect(valueType.kind).toBe("uint");
      expect(valueType.bits).toBe(256);
    });

    it("should parse reference types", () => {
      const input = `
        name Test;
        define {
          struct Point { x: uint256; y: uint256; };
        }
        storage {
          [0] position: Point;
        }
        code {}
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const position = result.declarations.find((d) => d.name === "position");

      expect(position?.declaredType?.type).toBe("ReferenceType");
      expect((position?.declaredType as Ast.ReferenceType).name).toBe("Point");
    });
  });

  describe("Declaration Parsing", () => {
    it("should parse struct declarations", () => {
      const input = `
        name Test;
        define {
          struct Point {
            x: uint256;
            y: uint256;
          };
        }
        storage {}
        code {}
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const struct = result.declarations[0];

      expect(struct.type).toBe("Declaration");
      expect(struct.kind).toBe("struct");
      expect(struct.name).toBe("Point");
      expect(struct.metadata?.fields).toHaveLength(2);

      const [x, y] = struct.metadata?.fields || [];
      expect(x.kind).toBe("field");
      expect(x.name).toBe("x");
      expect(y.name).toBe("y");
    });

    it("should parse storage declarations", () => {
      const input = `
        name Test;
        storage {
          [0] balance: uint256;
          [42] data: bytes32;
        }
        code {}
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const [balance, data] = result.declarations;

      expect(balance.kind).toBe("storage");
      expect(balance.metadata?.slot).toBe(0);
      expect(data.metadata?.slot).toBe(42);
    });

    it("should parse variable declarations", () => {
      const input = `
        name Test;
        storage {}
        code {
          let x = 42;
          let flag = true;
        }
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const [letX, letFlag] = result.body.items as Ast.DeclarationStatement[];

      expect(letX.type).toBe("DeclarationStatement");
      expect(letX.declaration.kind).toBe("variable");
      expect(letX.declaration.name).toBe("x");

      const xInit = letX.declaration.initializer as Ast.LiteralExpression;
      expect(xInit.type).toBe("LiteralExpression");
      expect(xInit.kind).toBe("number");
      expect(xInit.value).toBe("42");

      const flagInit = letFlag.declaration.initializer as Ast.LiteralExpression;
      expect(flagInit.kind).toBe("boolean");
      expect(flagInit.value).toBe("true");
    });
  });

  describe("Expression Parsing", () => {
    it("should parse literal expressions", () => {
      const input = `
        name Test;
        storage {}
        code {
          42;
          0x1234;
          "hello";
          true;
          false;
          0x1234567890123456789012345678901234567890;
          100 ether;
        }
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const stmts = result.body.items as Ast.ExpressionStatement[];
      const exprs = stmts.map((s) => s.expression as Ast.LiteralExpression);

      expect(exprs[0].kind).toBe("number");
      expect(exprs[0].value).toBe("42");

      expect(exprs[1].kind).toBe("hex");
      expect(exprs[1].value).toBe("0x1234");

      expect(exprs[2].kind).toBe("string");
      expect(exprs[2].value).toBe("hello");

      expect(exprs[3].kind).toBe("boolean");
      expect(exprs[3].value).toBe("true");

      expect(exprs[4].kind).toBe("boolean");
      expect(exprs[4].value).toBe("false");

      expect(exprs[5].kind).toBe("address");
      expect(exprs[5].value).toBe("0x1234567890123456789012345678901234567890");

      expect(exprs[6].kind).toBe("number");
      expect(exprs[6].value).toBe("100");
      expect(exprs[6].unit).toBe("ether");
    });

    it("should parse identifier expressions", () => {
      const input = `
        name Test;
        storage {}
        code {
          x;
          balance;
        }
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const stmts = result.body.items as Ast.ExpressionStatement[];
      const [x, balance] = stmts.map(
        (s) => s.expression as Ast.IdentifierExpression,
      );

      expect(x.type).toBe("IdentifierExpression");
      expect(x.name).toBe("x");
      expect(balance.name).toBe("balance");
    });

    it("should parse operator expressions", () => {
      const input = `
        name Test;
        storage {}
        code {
          x + y;
          a * b;
          !flag;
          -value;
        }
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const stmts = result.body.items as Ast.ExpressionStatement[];
      const exprs = stmts.map((s) => s.expression as Ast.OperatorExpression);

      expect(exprs[0].operator).toBe("+");
      expect(exprs[0].operands).toHaveLength(2);

      expect(exprs[1].operator).toBe("*");

      expect(exprs[2].operator).toBe("!");
      expect(exprs[2].operands).toHaveLength(1);

      expect(exprs[3].operator).toBe("-");
      expect(exprs[3].operands).toHaveLength(1);
    });

    it("should parse access expressions", () => {
      const input = `
        name Test;
        storage {}
        code {
          point.x;
          arr[0];
          nested.field.subfield;
          matrix[i][j];
        }
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const stmts = result.body.items as Ast.ExpressionStatement[];
      const exprs = stmts.map((s) => s.expression as Ast.AccessExpression);

      expect(exprs[0].kind).toBe("member");
      expect(exprs[0].property).toBe("x");

      expect(exprs[1].kind).toBe("index");
      expect((exprs[1].property as Ast.LiteralExpression).value).toBe("0");

      // nested.field.subfield is two member accesses
      const nested = exprs[2];
      expect(nested.kind).toBe("member");
      expect(nested.property).toBe("subfield");
      const nestedObj = nested.object as Ast.AccessExpression;
      expect(nestedObj.kind).toBe("member");
      expect(nestedObj.property).toBe("field");

      // matrix[i][j] is two index accesses
      const matrix = exprs[3];
      expect(matrix.kind).toBe("index");
    });

    it("should parse special expressions", () => {
      const input = `
        name Test;
        storage {}
        code {
          msg.sender;
          msg.value;
          msg.data;
        }
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const stmts = result.body.items as Ast.ExpressionStatement[];
      const [sender, value, data] = stmts.map(
        (s) => s.expression as Ast.SpecialExpression,
      );

      expect(sender.type).toBe("SpecialExpression");
      expect(sender.kind).toBe("msg.sender");

      expect(value.type).toBe("SpecialExpression");
      expect(value.kind).toBe("msg.value");

      expect(data.type).toBe("SpecialExpression");
      expect(data.kind).toBe("msg.data");
    });

    it("should parse complex expressions with correct precedence", () => {
      const input = `
        name Test;
        storage {}
        code {
          a + b * c;
          x == y && z != w;
          !flag || value > 0;
        }
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const stmts = result.body.items as Ast.ExpressionStatement[];

      // a + b * c should be a + (b * c)
      const expr1 = stmts[0].expression as Ast.OperatorExpression;
      expect(expr1.operator).toBe("+");
      const right1 = expr1.operands[1] as Ast.OperatorExpression;
      expect(right1.operator).toBe("*");

      // x == y && z != w should be (x == y) && (z != w)
      const expr2 = stmts[1].expression as Ast.OperatorExpression;
      expect(expr2.operator).toBe("&&");
      const left2 = expr2.operands[0] as Ast.OperatorExpression;
      expect(left2.operator).toBe("==");
      const right2 = expr2.operands[1] as Ast.OperatorExpression;
      expect(right2.operator).toBe("!=");
    });
  });

  describe("Statement Parsing", () => {
    it("should parse assignment statements", () => {
      const input = `
        name Test;
        storage {}
        code {
          x = 42;
          point.x = 100;
          arr[0] = value;
        }
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const stmts = result.body.items as Ast.AssignmentStatement[];

      expect(stmts[0].type).toBe("AssignmentStatement");
      expect((stmts[0].target as Ast.IdentifierExpression).name).toBe("x");
      expect((stmts[0].value as Ast.LiteralExpression).value).toBe("42");

      expect((stmts[1].target as Ast.AccessExpression).kind).toBe("member");
      expect((stmts[2].target as Ast.AccessExpression).kind).toBe("index");
    });

    it("should parse control flow statements", () => {
      const input = `
        name Test;
        storage {}
        code {
          if (x > 0) {
            return x;
          }

          if (flag) {
            break;
          } else {
            return 0;
          }

          for (let i = 0; i < 10; i = i + 1) {
            x = x + i;
          }
        }
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const [if1, if2, forLoop] = result.body
        .items as Ast.ControlFlowStatement[];

      expect(if1.kind).toBe("if");
      expect(if1.condition).toBeDefined();
      expect(if1.body?.items).toHaveLength(1);
      expect(if1.alternate).toBeUndefined();

      expect(if2.kind).toBe("if");
      expect(if2.body?.items[0].type).toBe("ControlFlowStatement");
      expect((if2.body?.items[0] as Ast.ControlFlowStatement).kind).toBe(
        "break",
      );
      expect(if2.alternate).toBeDefined();

      expect(forLoop.kind).toBe("for");
      expect(forLoop.init?.type).toBe("DeclarationStatement");
      expect(forLoop.condition).toBeDefined();
      expect(forLoop.update?.type).toBe("AssignmentStatement");
      expect(forLoop.body?.items).toHaveLength(1);
    });

    it("should parse return statements", () => {
      const input = `
        name Test;
        storage {}
        code {
          return;
          return 42;
          return x + y;
        }
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;
      const stmts = result.body.items as Ast.ControlFlowStatement[];

      expect(stmts[0].kind).toBe("return");
      expect(stmts[0].value).toBeUndefined();

      expect(stmts[1].kind).toBe("return");
      expect((stmts[1].value as Ast.LiteralExpression).value).toBe("42");

      expect(stmts[2].kind).toBe("return");
      expect((stmts[2].value as Ast.OperatorExpression).operator).toBe("+");
    });
  });

  describe("Complex Programs", () => {
    it("should parse complete program", () => {
      const input = `
        name SimpleStorage;

        define {
          struct User {
            username: string;
            balance: uint256;
          };
        }

        storage {
          [0] owner: address;
          [1] users: mapping<address, User>;
          [2] totalSupply: uint256;
        }

        code {
          let sender = msg.sender;

          if (sender == owner) {
            users[sender].balance = users[sender].balance + msg.value;
            totalSupply = totalSupply + msg.value;
          } else {
            return 0;
          }

          return users[sender].balance;
        }
      `;

      const parseResult = parse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) throw new Error("Parse failed");
      const result = parseResult.value;

      expect(result.name).toBe("SimpleStorage");
      expect(result.declarations).toHaveLength(4); // 1 struct + 3 storage

      const struct = result.declarations[0];
      expect(struct.kind).toBe("struct");
      expect(struct.metadata?.fields).toHaveLength(2);

      const codeStmts = result.body.items;
      expect(codeStmts).toHaveLength(3); // let, if, return

      const ifStmt = codeStmts[1] as Ast.ControlFlowStatement;
      expect(ifStmt.body?.items).toHaveLength(2); // two assignments
      expect(ifStmt.alternate?.items).toHaveLength(1); // one return
    });
  });

  describe("Error Handling", () => {
    it("should handle parse errors gracefully", () => {
      const result = parse("invalid syntax");
      expect(result.success).toBe(false);
    });

    it("should provide helpful error messages", () => {
      const result = parse(`
        name Test;
        storage {
          0: x uint256;
        }
        code {}
      `);
      expect(result.success).toBe(false);
      if (!result.success) {
        // Error occurs at column 11 where parser expects "[" for storage slot syntax
        expect(result).toHaveMessage({
          severity: Severity.Error,
          message: "Parse error at line 4, column 11",
        });
      }
    });
  });
});
