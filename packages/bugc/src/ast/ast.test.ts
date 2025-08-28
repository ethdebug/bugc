import { describe, it, expect } from "vitest";
import {
  Ast,
  Program,
  Declaration,
  Block,
  Expression,
  Statement,
  BaseAstVisitor,
  cloneNode,
  updateNode,
  setParentReferences,
  isExpression,
  isStatement,
  isTypeNode,
  isAssignable,
} from "./ast";

describe("Ast", () => {
  describe("Factory Functions", () => {
    it("should create program nodes", () => {
      const program = Ast.program(
        "Test",
        [],
        Ast.block("program", []),
        Ast.block("program", []),
      );
      expect(program.type).toBe("Program");
      expect(program.name).toBe("Test");
      expect(program.declarations).toEqual([]);
      expect(program.body.type).toBe("Block");
      expect(program.loc).toBeNull();
    });

    it("should create declaration nodes", () => {
      const decl = Ast.declaration(
        "variable",
        "x",
        Ast.elementaryType("uint", 256),
      );
      expect(decl.type).toBe("Declaration");
      expect(decl.kind).toBe("variable");
      expect(decl.name).toBe("x");
      expect(decl.declaredType?.type).toBe("ElementaryType");
    });

    it("should create struct declarations with fields", () => {
      const fields = [
        Ast.declaration("field", "x", Ast.elementaryType("uint", 256)),
        Ast.declaration("field", "y", Ast.elementaryType("uint", 256)),
      ];
      const struct = Ast.declaration("struct", "Point", undefined, undefined, {
        fields,
      });

      expect(struct.kind).toBe("struct");
      expect(struct.metadata?.fields).toHaveLength(2);
      expect(struct.metadata?.fields?.[0].name).toBe("x");
    });

    it("should create storage declarations with slot", () => {
      const storage = Ast.declaration(
        "storage",
        "balance",
        Ast.elementaryType("uint", 256),
        undefined,
        { slot: 0 },
      );

      expect(storage.kind).toBe("storage");
      expect(storage.metadata?.slot).toBe(0);
    });

    it("should create block nodes", () => {
      const block = Ast.block("statements", [
        Ast.expressionStmt(Ast.identifier("x")),
      ]);
      expect(block.type).toBe("Block");
      expect(block.kind).toBe("statements");
      expect(block.items).toHaveLength(1);
    });

    it("should create type nodes", () => {
      const elementary = Ast.elementaryType("uint", 256);
      expect(elementary.type).toBe("ElementaryType");
      expect(elementary.kind).toBe("uint");
      expect(elementary.bits).toBe(256);

      const array = Ast.complexType("array", {
        typeArgs: [elementary],
        size: 10,
      });
      expect(array.type).toBe("ComplexType");
      expect(array.kind).toBe("array");
      expect(array.size).toBe(10);
      expect(array.typeArgs).toHaveLength(1);

      const mapping = Ast.complexType("mapping", {
        typeArgs: [
          Ast.elementaryType("address"),
          Ast.elementaryType("uint", 256),
        ],
      });
      expect(mapping.kind).toBe("mapping");
      expect(mapping.typeArgs).toHaveLength(2);

      const ref = Ast.referenceType("Point");
      expect(ref.type).toBe("ReferenceType");
      expect(ref.name).toBe("Point");
    });

    it("should create expression nodes", () => {
      const id = Ast.identifier("x");
      expect(id.type).toBe("IdentifierExpression");
      expect(id.name).toBe("x");

      const literal = Ast.literal("number", "42");
      expect(literal.type).toBe("LiteralExpression");
      expect(literal.kind).toBe("number");
      expect(literal.value).toBe("42");

      const weiLiteral = Ast.literal("number", "1", "ether");
      expect(weiLiteral.unit).toBe("ether");

      const binary = Ast.operator("+", [id, literal]);
      expect(binary.type).toBe("OperatorExpression");
      expect(binary.operator).toBe("+");
      expect(binary.operands).toHaveLength(2);

      const unary = Ast.operator("!", [id]);
      expect(unary.operands).toHaveLength(1);

      const member = Ast.access("member", id, "field");
      expect(member.type).toBe("AccessExpression");
      expect(member.kind).toBe("member");
      expect(member.property).toBe("field");

      const index = Ast.access("index", id, literal);
      expect(index.kind).toBe("index");
      expect((index.property as Expression).type).toBe("LiteralExpression");

      const call = Ast.call(id, [literal]);
      expect(call.type).toBe("CallExpression");
      expect(call.arguments).toHaveLength(1);

      const special = Ast.special("msg.sender");
      expect(special.type).toBe("SpecialExpression");
      expect(special.kind).toBe("msg.sender");
    });

    it("should create statement nodes", () => {
      const declStmt = Ast.declarationStmt(
        Ast.declaration(
          "variable",
          "x",
          undefined,
          Ast.literal("number", "42"),
        ),
      );
      expect(declStmt.type).toBe("DeclarationStatement");

      const assign = Ast.assignment(
        Ast.identifier("x"),
        Ast.literal("number", "10"),
      );
      expect(assign.type).toBe("AssignmentStatement");
      expect(assign.operator).toBeUndefined();

      const compoundAssign = Ast.assignment(
        Ast.identifier("x"),
        Ast.literal("number", "10"),
        "+=",
      );
      expect(compoundAssign.operator).toBe("+=");

      const ifStmt = Ast.controlFlow("if", {
        condition: Ast.literal("boolean", "true"),
        body: Ast.block("statements", []),
      });
      expect(ifStmt.type).toBe("ControlFlowStatement");
      expect(ifStmt.kind).toBe("if");

      const forStmt = Ast.controlFlow("for", {
        init: declStmt,
        condition: Ast.literal("boolean", "true"),
        update: assign,
        body: Ast.block("statements", []),
      });
      expect(forStmt.kind).toBe("for");

      const returnStmt = Ast.controlFlow("return", {
        value: Ast.identifier("x"),
      });
      expect(returnStmt.kind).toBe("return");

      const breakStmt = Ast.controlFlow("break", {});
      expect(breakStmt.kind).toBe("break");

      const exprStmt = Ast.expressionStmt(Ast.identifier("x"));
      expect(exprStmt.type).toBe("ExpressionStatement");
    });

    it("should handle source locations", () => {
      const loc = {
        offset: 0,
        length: 5,
      };

      const node = Ast.identifier("test", loc);
      expect(node.loc).toEqual(loc);
    });
  });

  describe("Type Guards", () => {
    it("should identify expressions", () => {
      expect(isExpression(Ast.identifier("x"))).toBe(true);
      expect(isExpression(Ast.literal("number", "42"))).toBe(true);
      expect(isExpression(Ast.operator("+", []))).toBe(true);
      expect(isExpression(Ast.access("member", Ast.identifier("x"), "y"))).toBe(
        true,
      );
      expect(isExpression(Ast.call(Ast.identifier("f"), []))).toBe(true);
      expect(isExpression(Ast.special("msg.sender"))).toBe(true);

      expect(isExpression(Ast.block("statements", []))).toBe(false);
      expect(isExpression(Ast.elementaryType("uint", 256))).toBe(false);
    });

    it("should identify statements", () => {
      expect(
        isStatement(Ast.declarationStmt(Ast.declaration("variable", "x"))),
      ).toBe(true);
      expect(
        isStatement(
          Ast.assignment(Ast.identifier("x"), Ast.literal("number", "1")),
        ),
      ).toBe(true);
      expect(isStatement(Ast.controlFlow("if", {}))).toBe(true);
      expect(isStatement(Ast.expressionStmt(Ast.identifier("x")))).toBe(true);

      expect(isStatement(Ast.identifier("x"))).toBe(false);
      expect(isStatement(Ast.block("statements", []))).toBe(false);
    });

    it("should identify type nodes", () => {
      expect(isTypeNode(Ast.elementaryType("uint", 256))).toBe(true);
      expect(
        isTypeNode(
          Ast.complexType("array", {
            typeArgs: [Ast.elementaryType("uint", 256)],
          }),
        ),
      ).toBe(true);
      expect(isTypeNode(Ast.referenceType("Point"))).toBe(true);

      expect(isTypeNode(Ast.identifier("x"))).toBe(false);
      expect(isTypeNode(Ast.block("statements", []))).toBe(false);
    });

    it("should identify assignable expressions", () => {
      expect(isAssignable(Ast.identifier("x"))).toBe(true);
      expect(isAssignable(Ast.access("member", Ast.identifier("x"), "y"))).toBe(
        true,
      );
      expect(
        isAssignable(
          Ast.access("index", Ast.identifier("x"), Ast.literal("number", "0")),
        ),
      ).toBe(true);

      expect(isAssignable(Ast.literal("number", "42"))).toBe(false);
      expect(isAssignable(Ast.operator("+", []))).toBe(false);
      expect(isAssignable(Ast.call(Ast.identifier("f"), []))).toBe(false);
      expect(isAssignable(Ast.special("msg.sender"))).toBe(false);
    });
  });

  describe("Visitor Pattern", () => {
    class TestVisitor extends BaseAstVisitor<string> {
      visitProgram(node: Program): string {
        return `Program(${node.name})`;
      }
      visitDeclaration(node: Declaration): string {
        return `Declaration(${node.kind}:${node.name})`;
      }
      visitBlock(node: Block): string {
        return `Block(${node.kind})`;
      }
      visitElementaryType(node: { kind: string; bits?: number }): string {
        return `ElementaryType(${node.kind}${node.bits ? node.bits : ""})`;
      }
      visitComplexType(node: { kind: string }): string {
        return `ComplexType(${node.kind})`;
      }
      visitReferenceType(node: { name: string }): string {
        return `ReferenceType(${node.name})`;
      }
      visitDeclarationStatement(_node: Statement): string {
        return "DeclarationStatement";
      }
      visitAssignmentStatement(_node: Statement): string {
        return "AssignmentStatement";
      }
      visitControlFlowStatement(node: { kind: string }): string {
        return `ControlFlowStatement(${node.kind})`;
      }
      visitExpressionStatement(_node: Statement): string {
        return "ExpressionStatement";
      }
      visitIdentifierExpression(node: { name: string }): string {
        return `Identifier(${node.name})`;
      }
      visitLiteralExpression(node: { kind: string; value: string }): string {
        return `Literal(${node.kind}:${node.value})`;
      }
      visitOperatorExpression(node: { operator: string }): string {
        return `Operator(${node.operator})`;
      }
      visitAccessExpression(node: { kind: string }): string {
        return `Access(${node.kind})`;
      }
      visitCallExpression(_node: Expression): string {
        return "Call";
      }
      visitSpecialExpression(node: { kind: string }): string {
        return `Special(${node.kind})`;
      }
      visitCastExpression(_node: Expression): string {
        return "Cast";
      }
    }

    it("should visit all node types", () => {
      const visitor = new TestVisitor();

      expect(
        visitor.visit(
          Ast.program(
            "Test",
            [],
            Ast.block("program", []),
            Ast.block("program", []),
          ),
        ),
      ).toBe("Program(Test)");
      expect(visitor.visit(Ast.declaration("variable", "x"))).toBe(
        "Declaration(variable:x)",
      );
      expect(visitor.visit(Ast.block("statements", []))).toBe(
        "Block(statements)",
      );
      expect(visitor.visit(Ast.elementaryType("uint", 256))).toBe(
        "ElementaryType(uint256)",
      );
      expect(visitor.visit(Ast.complexType("array", {}))).toBe(
        "ComplexType(array)",
      );
      expect(visitor.visit(Ast.referenceType("Point"))).toBe(
        "ReferenceType(Point)",
      );
      expect(visitor.visit(Ast.identifier("x"))).toBe("Identifier(x)");
      expect(visitor.visit(Ast.literal("number", "42"))).toBe(
        "Literal(number:42)",
      );
      expect(visitor.visit(Ast.operator("+", []))).toBe("Operator(+)");
      expect(
        visitor.visit(Ast.access("member", Ast.identifier("x"), "y")),
      ).toBe("Access(member)");
      expect(visitor.visit(Ast.call(Ast.identifier("f"), []))).toBe("Call");
      expect(visitor.visit(Ast.special("msg.sender"))).toBe(
        "Special(msg.sender)",
      );
      expect(visitor.visit(Ast.controlFlow("if", {}))).toBe(
        "ControlFlowStatement(if)",
      );
    });

    it("should throw on unknown node type", () => {
      const visitor = new TestVisitor();
      const badNode = { type: "Unknown", loc: null } as unknown as Parameters<
        typeof visitor.visit
      >[0];

      expect(() => visitor.visit(badNode)).toThrow(
        "Unknown node type: Unknown",
      );
    });
  });

  describe("Utility Functions", () => {
    describe("cloneNode", () => {
      it("should deep clone nodes", () => {
        const original = Ast.operator("+", [
          Ast.identifier("x"),
          Ast.literal("number", "42"),
        ]);
        const clone = cloneNode(original);

        expect(clone).not.toBe(original);
        expect(clone.operands[0]).not.toBe(original.operands[0]);
        expect(clone.operands[1]).not.toBe(original.operands[1]);
        expect(clone).toEqual(original);
      });

      it("should not clone parent references", () => {
        const parent = Ast.block("statements", []);
        const child = Ast.identifier("x");
        child.parent = parent;

        const clone = cloneNode(child);
        expect(clone.parent).toBeUndefined();
      });

      it("should handle complex nested structures", () => {
        const program = Ast.program(
          "Test",
          [
            Ast.declaration("struct", "Point", undefined, undefined, {
              fields: [
                Ast.declaration("field", "x", Ast.elementaryType("uint", 256)),
                Ast.declaration("field", "y", Ast.elementaryType("uint", 256)),
              ],
            }),
          ],
          Ast.block("program", [
            Ast.controlFlow("if", {
              condition: Ast.operator("==", [
                Ast.special("msg.sender"),
                Ast.identifier("owner"),
              ]),
              body: Ast.block("statements", [
                Ast.assignment(
                  Ast.identifier("x"),
                  Ast.literal("number", "42"),
                ),
              ]),
            }),
          ]),
          Ast.block("program", []),
        );

        const clone = cloneNode(program);
        expect(clone).not.toBe(program);
        expect(clone.declarations[0]).not.toBe(program.declarations[0]);
        expect(clone.body).not.toBe(program.body);
        expect(clone).toEqual(program);
      });
    });

    describe("updateNode", () => {
      it("should create updated copy", () => {
        const original = Ast.identifier("x");
        const updated = updateNode(original, { name: "y" });

        expect(updated).not.toBe(original);
        expect(updated.name).toBe("y");
        expect(original.name).toBe("x");
      });
    });

    describe("setParentReferences", () => {
      it("should set parent references throughout tree", () => {
        const program = Ast.program(
          "Test",
          [],
          Ast.block("program", [
            Ast.expressionStmt(
              Ast.operator("+", [
                Ast.identifier("x"),
                Ast.literal("number", "42"),
              ]),
            ),
          ]),
          Ast.block("program", []),
        );

        setParentReferences(program);

        expect(program.parent).toBeUndefined();
        expect(program.body.parent).toBe(program);

        const stmt = program.body.items[0] as Statement;
        expect(stmt.parent).toBe(program.body);

        const expr = (
          stmt as { expression: Expression & { operands: Expression[] } }
        ).expression;
        expect(expr.parent).toBe(stmt);
        expect(expr.operands[0].parent).toBe(expr);
        expect(expr.operands[1].parent).toBe(expr);
      });

      it("should handle arrays of nodes", () => {
        const block = Ast.block("statements", [
          Ast.expressionStmt(Ast.identifier("a")),
          Ast.expressionStmt(Ast.identifier("b")),
          Ast.expressionStmt(Ast.identifier("c")),
        ]);

        setParentReferences(block);

        block.items.forEach((item) => {
          expect(item.parent).toBe(block);
        });
      });
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle realistic program structure", () => {
      const program = Ast.program(
        "SimpleStorage",
        [
          // struct User { name: string; balance: uint256; }
          Ast.declaration("struct", "User", undefined, undefined, {
            fields: [
              Ast.declaration("field", "name", Ast.elementaryType("string")),
              Ast.declaration(
                "field",
                "balance",
                Ast.elementaryType("uint", 256),
              ),
            ],
          }),

          // storage { 0: owner: address; 1: users: mapping<address, User>; }
          Ast.declaration(
            "storage",
            "owner",
            Ast.elementaryType("address"),
            undefined,
            { slot: 0 },
          ),
          Ast.declaration(
            "storage",
            "users",
            Ast.complexType("mapping", {
              typeArgs: [
                Ast.elementaryType("address"),
                Ast.referenceType("User"),
              ],
            }),
            undefined,
            { slot: 1 },
          ),
        ],
        Ast.block("program", [
          // let sender = msg.sender;
          Ast.declarationStmt(
            Ast.declaration(
              "variable",
              "sender",
              undefined,
              Ast.special("msg.sender"),
            ),
          ),

          // if (sender == owner) { users[sender].balance = users[sender].balance + msg.value; }
          Ast.controlFlow("if", {
            condition: Ast.operator("==", [
              Ast.identifier("sender"),
              Ast.identifier("owner"),
            ]),
            body: Ast.block("statements", [
              Ast.assignment(
                Ast.access(
                  "member",
                  Ast.access(
                    "index",
                    Ast.identifier("users"),
                    Ast.identifier("sender"),
                  ),
                  "balance",
                ),
                Ast.operator("+", [
                  Ast.access(
                    "member",
                    Ast.access(
                      "index",
                      Ast.identifier("users"),
                      Ast.identifier("sender"),
                    ),
                    "balance",
                  ),
                  Ast.special("msg.value"),
                ]),
              ),
            ]),
          }),
        ]),
        Ast.block("program", []),
      );

      expect(program.type).toBe("Program");
      expect(program.declarations).toHaveLength(3);
      expect(program.body.items).toHaveLength(2);

      // Verify structure
      const structDecl = program.declarations[0];
      expect(structDecl.kind).toBe("struct");
      expect(structDecl.metadata?.fields).toHaveLength(2);

      const ifStmt = program.body.items[1] as { type: string; kind?: string };
      expect(ifStmt.type).toBe("ControlFlowStatement");
      expect(ifStmt.kind).toBe("if");
    });
  });
});
