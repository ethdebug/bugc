import { describe, it, expect } from "vitest";

import * as Ast from "#ast/spec";

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

    it("should create variable declaration nodes", () => {
      const decl = Ast.Declaration.variable(
        "x",
        Ast.Type.elementary("uint", 256),
      );
      expect(decl.type).toBe("Declaration");
      expect(decl.kind).toBe("variable");
      expect(decl.name).toBe("x");
      expect(decl.declaredType?.type).toBe("ElementaryType");
    });

    it("should create struct declarations with fields", () => {
      const fields = [
        Ast.Declaration.field("x", Ast.Type.elementary("uint", 256)),
        Ast.Declaration.field("y", Ast.Type.elementary("uint", 256)),
      ];
      const struct = Ast.Declaration.struct("Point", undefined, undefined, {
        fields,
      });

      expect(struct.kind).toBe("struct");
      expect(struct.metadata?.fields).toHaveLength(2);
      expect(struct.metadata?.fields?.[0].name).toBe("x");
    });

    it("should create storage declarations with slot", () => {
      const storage = Ast.Declaration.storage(
        "balance",
        Ast.Type.elementary("uint", 256),
        undefined,
        { slot: 0 },
      );

      expect(storage.kind).toBe("storage");
      expect(storage.metadata?.slot).toBe(0);
    });

    it("should create block nodes", () => {
      const block = Ast.block("statements", [
        Ast.Statement.express(Ast.Expression.identifier("x")),
      ]);
      expect(block.type).toBe("Block");
      expect(block.kind).toBe("statements");
      expect(block.items).toHaveLength(1);
    });

    it("should create type nodes", () => {
      const elementary = Ast.Type.elementary("uint", 256);
      expect(elementary.type).toBe("ElementaryType");
      expect(elementary.kind).toBe("uint");
      expect(elementary.bits).toBe(256);

      const array = Ast.Type.complex("array", {
        typeArgs: [elementary],
        size: 10,
      });
      expect(array.type).toBe("ComplexType");
      expect(array.kind).toBe("array");
      expect(array.size).toBe(10);
      expect(array.typeArgs).toHaveLength(1);

      const mapping = Ast.Type.complex("mapping", {
        typeArgs: [
          Ast.Type.elementary("address"),
          Ast.Type.elementary("uint", 256),
        ],
      });
      expect(mapping.kind).toBe("mapping");
      expect(mapping.typeArgs).toHaveLength(2);

      const ref = Ast.Type.reference("Point");
      expect(ref.type).toBe("ReferenceType");
      expect(ref.name).toBe("Point");
    });

    it("should create expression nodes", () => {
      const id = Ast.Expression.identifier("x");
      expect(id.type).toBe("IdentifierExpression");
      expect(id.name).toBe("x");

      const literal = Ast.Expression.literal("number", "42");
      expect(literal.type).toBe("LiteralExpression");
      expect(literal.kind).toBe("number");
      expect(literal.value).toBe("42");

      const weiLiteral = Ast.Expression.literal("number", "1", "ether");
      expect(weiLiteral.unit).toBe("ether");

      const binary = Ast.Expression.operator("+", [id, literal]);
      expect(binary.type).toBe("OperatorExpression");
      expect(binary.operator).toBe("+");
      expect(binary.operands).toHaveLength(2);

      const unary = Ast.Expression.operator("!", [id]);
      expect(unary.operands).toHaveLength(1);

      const member = Ast.Expression.access("member", id, "field");
      expect(member.type).toBe("AccessExpression");
      expect(member.kind).toBe("member");
      expect(member.property).toBe("field");

      const index = Ast.Expression.access("index", id, literal);
      expect(index.kind).toBe("index");
      expect((index.property as Ast.Expression).type).toBe("LiteralExpression");

      const call = Ast.Expression.call(id, [literal]);
      expect(call.type).toBe("CallExpression");
      expect(call.arguments).toHaveLength(1);

      const special = Ast.Expression.special("msg.sender");
      expect(special.type).toBe("SpecialExpression");
      expect(special.kind).toBe("msg.sender");
    });

    it("should create statement nodes", () => {
      const declStmt = Ast.Statement.declare(
        Ast.Declaration.variable(
          "x",
          undefined,
          Ast.Expression.literal("number", "42"),
        ),
      );
      expect(declStmt.type).toBe("DeclarationStatement");

      const assign = Ast.Statement.assign(
        Ast.Expression.identifier("x"),
        Ast.Expression.literal("number", "10"),
      );
      expect(assign.type).toBe("AssignmentStatement");
      expect(assign.operator).toBeUndefined();

      const compoundAssign = Ast.Statement.assign(
        Ast.Expression.identifier("x"),
        Ast.Expression.literal("number", "10"),
        "+=",
      );
      expect(compoundAssign.operator).toBe("+=");

      const ifStmt = Ast.Statement.controlFlow("if", {
        condition: Ast.Expression.literal("boolean", "true"),
        body: Ast.block("statements", []),
      });
      expect(ifStmt.type).toBe("ControlFlowStatement");
      expect(ifStmt.kind).toBe("if");

      const forStmt = Ast.Statement.controlFlow("for", {
        init: declStmt,
        condition: Ast.Expression.literal("boolean", "true"),
        update: assign,
        body: Ast.block("statements", []),
      });
      expect(forStmt.kind).toBe("for");

      const returnStmt = Ast.Statement.controlFlow("return", {
        value: Ast.Expression.identifier("x"),
      });
      expect(returnStmt.kind).toBe("return");

      const breakStmt = Ast.Statement.controlFlow("break", {});
      expect(breakStmt.kind).toBe("break");

      const exprStmt = Ast.Statement.express(Ast.Expression.identifier("x"));
      expect(exprStmt.type).toBe("ExpressionStatement");
    });

    it("should handle source locations", () => {
      const loc = {
        offset: 0,
        length: 5,
      };

      const node = Ast.Expression.identifier("test", loc);
      expect(node.loc).toEqual(loc);
    });
  });

  describe("Type Guards", () => {
    it("should identify expressions", () => {
      expect(Ast.isExpression(Ast.Expression.identifier("x"))).toBe(true);
      expect(Ast.isExpression(Ast.Expression.literal("number", "42"))).toBe(
        true,
      );
      expect(Ast.isExpression(Ast.Expression.operator("+", []))).toBe(true);
      expect(
        Ast.isExpression(
          Ast.Expression.access("member", Ast.Expression.identifier("x"), "y"),
        ),
      ).toBe(true);
      expect(
        Ast.isExpression(
          Ast.Expression.call(Ast.Expression.identifier("f"), []),
        ),
      ).toBe(true);
      expect(Ast.isExpression(Ast.Expression.special("msg.sender"))).toBe(true);

      expect(Ast.isExpression(Ast.block("statements", []))).toBe(false);
      expect(Ast.isExpression(Ast.Type.elementary("uint", 256))).toBe(false);
    });

    it("should identify statements", () => {
      expect(
        Ast.isStatement(
          Ast.Statement.declare(Ast.Declaration.variable("x")),
        ),
      ).toBe(true);
      expect(
        Ast.isStatement(
          Ast.Statement.assign(
            Ast.Expression.identifier("x"),
            Ast.Expression.literal("number", "1"),
          ),
        ),
      ).toBe(true);
      expect(Ast.isStatement(Ast.Statement.controlFlow("if", {}))).toBe(true);
      expect(
        Ast.isStatement(Ast.Statement.express(Ast.Expression.identifier("x"))),
      ).toBe(true);

      expect(Ast.isStatement(Ast.Expression.identifier("x"))).toBe(false);
      expect(Ast.isStatement(Ast.block("statements", []))).toBe(false);
    });

    it("should identify type nodes", () => {
      expect(Ast.isType(Ast.Type.elementary("uint", 256))).toBe(true);
      expect(
        Ast.isType(
          Ast.Type.complex("array", {
            typeArgs: [Ast.Type.elementary("uint", 256)],
          }),
        ),
      ).toBe(true);
      expect(Ast.isType(Ast.Type.reference("Point"))).toBe(true);

      expect(Ast.isType(Ast.Expression.identifier("x"))).toBe(false);
      expect(Ast.isType(Ast.block("statements", []))).toBe(false);
    });

    it("should identify assignable expressions", () => {
      expect(Ast.Expression.isAssignable(Ast.Expression.identifier("x"))).toBe(
        true,
      );
      expect(
        Ast.Expression.isAssignable(
          Ast.Expression.access("member", Ast.Expression.identifier("x"), "y"),
        ),
      ).toBe(true);
      expect(
        Ast.Expression.isAssignable(
          Ast.Expression.access(
            "index",
            Ast.Expression.identifier("x"),
            Ast.Expression.literal("number", "0"),
          ),
        ),
      ).toBe(true);

      expect(
        Ast.Expression.isAssignable(Ast.Expression.literal("number", "42")),
      ).toBe(false);
      expect(
        Ast.Expression.isAssignable(Ast.Expression.operator("+", [])),
      ).toBe(false);
      expect(
        Ast.Expression.isAssignable(
          Ast.Expression.call(Ast.Expression.identifier("f"), []),
        ),
      ).toBe(false);
      expect(
        Ast.Expression.isAssignable(Ast.Expression.special("msg.sender")),
      ).toBe(false);
    });
  });

  describe("Utility Functions", () => {
    describe("cloneNode", () => {
      it("should deep clone nodes", () => {
        const original = Ast.Expression.operator("+", [
          Ast.Expression.identifier("x"),
          Ast.Expression.literal("number", "42"),
        ]);
        const clone = Ast.Node.clone(original);

        expect(clone).not.toBe(original);
        expect(clone.operands[0]).not.toBe(original.operands[0]);
        expect(clone.operands[1]).not.toBe(original.operands[1]);
        expect(clone).toEqual(original);
      });

      it("should handle complex nested structures", () => {
        const program = Ast.program(
          "Test",
          [
            Ast.Declaration.struct("Point", undefined, undefined, {
              fields: [
                Ast.Declaration.field("x", Ast.Type.elementary("uint", 256)),
                Ast.Declaration.field("y", Ast.Type.elementary("uint", 256)),
              ],
            }),
          ],
          Ast.block("program", [
            Ast.Statement.controlFlow("if", {
              condition: Ast.Expression.operator("==", [
                Ast.Expression.special("msg.sender"),
                Ast.Expression.identifier("owner"),
              ]),
              body: Ast.block("statements", [
                Ast.Statement.assign(
                  Ast.Expression.identifier("x"),
                  Ast.Expression.literal("number", "42"),
                ),
              ]),
            }),
          ]),
          Ast.block("program", []),
        );

        const clone = Ast.Node.clone(program);
        expect(clone).not.toBe(program);
        expect(clone.declarations[0]).not.toBe(program.declarations[0]);
        expect(clone.body).not.toBe(program.body);
        expect(clone).toEqual(program);
      });
    });

    describe("updateNode", () => {
      it("should create updated copy", () => {
        const original = Ast.Expression.identifier("x");
        const updated = Ast.Node.update(original, { name: "y" });

        expect(updated).not.toBe(original);
        expect(updated.name).toBe("y");
        expect(original.name).toBe("x");
      });
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle realistic program structure", () => {
      const program = Ast.program(
        "SimpleStorage",
        [
          // struct User { name: string; balance: uint256; }
          Ast.Declaration.struct("User", undefined, undefined, {
            fields: [
              Ast.Declaration.field("name", Ast.Type.elementary("string")),
              Ast.Declaration.field("balance", Ast.Type.elementary("uint", 256)),
            ],
          }),

          // storage { 0: owner: address; 1: users: mapping<address, User>; }
          Ast.Declaration.storage(
            "owner",
            Ast.Type.elementary("address"),
            undefined,
            { slot: 0 },
          ),
          Ast.Declaration.storage(
            "users",
            Ast.Type.complex("mapping", {
              typeArgs: [
                Ast.Type.elementary("address"),
                Ast.Type.reference("User"),
              ],
            }),
            undefined,
            { slot: 1 },
          ),
        ],
        Ast.block("program", [
          // let sender = msg.sender;
          Ast.Statement.declare(
            Ast.Declaration.variable(
              "sender",
              undefined,
              Ast.Expression.special("msg.sender"),
            ),
          ),

          // if (sender == owner) { users[sender].balance = users[sender].balance + msg.value; }
          Ast.Statement.controlFlow("if", {
            condition: Ast.Expression.operator("==", [
              Ast.Expression.identifier("sender"),
              Ast.Expression.identifier("owner"),
            ]),
            body: Ast.block("statements", [
              Ast.Statement.assign(
                Ast.Expression.access(
                  "member",
                  Ast.Expression.access(
                    "index",
                    Ast.Expression.identifier("users"),
                    Ast.Expression.identifier("sender"),
                  ),
                  "balance",
                ),
                Ast.Expression.operator("+", [
                  Ast.Expression.access(
                    "member",
                    Ast.Expression.access(
                      "index",
                      Ast.Expression.identifier("users"),
                      Ast.Expression.identifier("sender"),
                    ),
                    "balance",
                  ),
                  Ast.Expression.special("msg.value"),
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
