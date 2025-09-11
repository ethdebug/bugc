import { describe, it, expect } from "vitest";

import * as Ast from "#ast/spec";

// Helper to create test IDs
let testIdCounter = 0;
const createId = (): Ast.Id => `test-${testIdCounter++}` as Ast.Id;

describe("Ast", () => {
  describe("Factory Functions", () => {
    it("should create program nodes", () => {
      const program = Ast.program(
        createId(),
        "Test",
        [],
        Ast.block(createId(), "program", []),
        Ast.block(createId(), "program", []),
      );
      expect(program.type).toBe("Program");
      expect(program.name).toBe("Test");
      expect(program.declarations).toEqual([]);
      expect(program.body?.type).toBe("Block");
      expect(program.loc).toBeNull();
    });

    it("should create variable declaration nodes", () => {
      const decl = Ast.Declaration.variable(
        createId(),
        "x",
        Ast.Type.elementary(createId(), "uint", 256),
      );
      expect(decl.type).toBe("Declaration");
      expect(decl.kind).toBe("variable");
      expect(decl.name).toBe("x");
      expect(decl.declaredType?.type).toBe("ElementaryType");
    });

    it("should create struct declarations with fields", () => {
      const fields = [
        Ast.Declaration.field(
          createId(),
          "x",
          Ast.Type.elementary(createId(), "uint", 256),
        ),
        Ast.Declaration.field(
          createId(),
          "y",
          Ast.Type.elementary(createId(), "uint", 256),
        ),
      ];
      const struct = Ast.Declaration.struct(createId(), "Point", fields);

      expect(struct.kind).toBe("struct");
      expect(struct.fields).toHaveLength(2);
      expect(struct.fields[0].name).toBe("x");
    });

    it("should create storage declarations with slot", () => {
      const storage = Ast.Declaration.storage(
        createId(),
        "balance",
        Ast.Type.elementary(createId(), "uint", 256),
        0,
      );

      expect(storage.kind).toBe("storage");
      expect(storage.slot).toBe(0);
    });

    it("should create block nodes", () => {
      const block = Ast.block(createId(), "statements", [
        Ast.Statement.express(
          createId(),
          Ast.Expression.identifier(createId(), "x"),
        ),
      ]);
      expect(block.type).toBe("Block");
      expect(block.kind).toBe("statements");
      expect(block.items).toHaveLength(1);
    });

    it("should create type nodes", () => {
      const elementary = Ast.Type.elementary(createId(), "uint", 256);
      expect(elementary.type).toBe("ElementaryType");
      expect(elementary.kind).toBe("uint");
      expect(elementary.bits).toBe(256);

      const array = Ast.Type.complex(createId(), "array", {
        typeArgs: [elementary],
        size: 10,
      });
      expect(array.type).toBe("ComplexType");
      expect(array.kind).toBe("array");
      expect(array.size).toBe(10);
      expect(array.typeArgs).toHaveLength(1);

      const mapping = Ast.Type.complex(createId(), "mapping", {
        typeArgs: [
          Ast.Type.elementary(createId(), "address"),
          Ast.Type.elementary(createId(), "uint", 256),
        ],
      });
      expect(mapping.kind).toBe("mapping");
      expect(mapping.typeArgs).toHaveLength(2);

      const ref = Ast.Type.reference(createId(), "Point");
      expect(ref.type).toBe("ReferenceType");
      expect(ref.name).toBe("Point");
    });

    it("should create expression nodes", () => {
      const id = Ast.Expression.identifier(createId(), "x");
      expect(id.type).toBe("IdentifierExpression");
      expect(id.name).toBe("x");

      const literal = Ast.Expression.literal(createId(), "number", "42");
      expect(literal.type).toBe("LiteralExpression");
      expect(literal.kind).toBe("number");
      expect(literal.value).toBe("42");

      const weiLiteral = Ast.Expression.literal(
        createId(),
        "number",
        "1",
        "ether",
      );
      expect(weiLiteral.unit).toBe("ether");

      const binary = Ast.Expression.operator(createId(), "+", [id, literal]);
      expect(binary.type).toBe("OperatorExpression");
      expect(binary.operator).toBe("+");
      expect(binary.operands).toHaveLength(2);

      const unary = Ast.Expression.operator(createId(), "!", [id]);
      expect(unary.operands).toHaveLength(1);

      const member = Ast.Expression.access(createId(), "member", id, "field");
      expect(member.type).toBe("AccessExpression");
      expect(member.kind).toBe("member");
      expect(member.property).toBe("field");

      const index = Ast.Expression.access(createId(), "index", id, literal);
      expect(index.kind).toBe("index");
      expect((index.property as Ast.Expression).type).toBe("LiteralExpression");

      const call = Ast.Expression.call(createId(), id, [literal]);
      expect(call.type).toBe("CallExpression");
      expect(call.arguments).toHaveLength(1);

      const special = Ast.Expression.special(createId(), "msg.sender");
      expect(special.type).toBe("SpecialExpression");
      expect(special.kind).toBe("msg.sender");
    });

    it("should create statement nodes", () => {
      const declStmt = Ast.Statement.declare(
        createId(),
        Ast.Declaration.variable(
          createId(),
          "x",
          undefined,
          Ast.Expression.literal(createId(), "number", "42"),
        ),
      );
      expect(declStmt.type).toBe("DeclarationStatement");

      const assign = Ast.Statement.assign(
        createId(),
        Ast.Expression.identifier(createId(), "x"),
        Ast.Expression.literal(createId(), "number", "10"),
      );
      expect(assign.type).toBe("AssignmentStatement");
      expect(assign.operator).toBeUndefined();

      const compoundAssign = Ast.Statement.assign(
        createId(),
        Ast.Expression.identifier(createId(), "x"),
        Ast.Expression.literal(createId(), "number", "10"),
        "+=",
      );
      expect(compoundAssign.operator).toBe("+=");

      const ifStmt = Ast.Statement.controlFlow(createId(), "if", {
        condition: Ast.Expression.literal(createId(), "boolean", "true"),
        body: Ast.block(createId(), "statements", []),
      });
      expect(ifStmt.type).toBe("ControlFlowStatement");
      expect(ifStmt.kind).toBe("if");

      const forStmt = Ast.Statement.controlFlow(createId(), "for", {
        init: declStmt,
        condition: Ast.Expression.literal(createId(), "boolean", "true"),
        update: assign,
        body: Ast.block(createId(), "statements", []),
      });
      expect(forStmt.kind).toBe("for");

      const returnStmt = Ast.Statement.controlFlow(createId(), "return", {
        value: Ast.Expression.identifier(createId(), "x"),
      });
      expect(returnStmt.kind).toBe("return");

      const breakStmt = Ast.Statement.controlFlow(createId(), "break", {});
      expect(breakStmt.kind).toBe("break");

      const exprStmt = Ast.Statement.express(
        createId(),
        Ast.Expression.identifier(createId(), "x"),
      );
      expect(exprStmt.type).toBe("ExpressionStatement");
    });

    it("should handle source locations", () => {
      const loc = {
        offset: 0,
        length: 5,
      };

      const node = Ast.Expression.identifier(createId(), "test", loc);
      expect(node.loc).toEqual(loc);
    });
  });

  describe("Type Guards", () => {
    it("should identify expressions", () => {
      expect(Ast.isExpression(Ast.Expression.identifier(createId(), "x"))).toBe(
        true,
      );
      expect(
        Ast.isExpression(Ast.Expression.literal(createId(), "number", "42")),
      ).toBe(true);
      expect(
        Ast.isExpression(Ast.Expression.operator(createId(), "+", [])),
      ).toBe(true);
      expect(
        Ast.isExpression(
          Ast.Expression.access(
            createId(),
            "member",
            Ast.Expression.identifier(createId(), "x"),
            "y",
          ),
        ),
      ).toBe(true);
      expect(
        Ast.isExpression(
          Ast.Expression.call(
            createId(),
            Ast.Expression.identifier(createId(), "f"),
            [],
          ),
        ),
      ).toBe(true);
      expect(
        Ast.isExpression(Ast.Expression.special(createId(), "msg.sender")),
      ).toBe(true);

      expect(Ast.isExpression(Ast.block(createId(), "statements", []))).toBe(
        false,
      );
      expect(
        Ast.isExpression(Ast.Type.elementary(createId(), "uint", 256)),
      ).toBe(false);
    });

    it("should identify statements", () => {
      expect(
        Ast.isStatement(
          Ast.Statement.declare(
            createId(),
            Ast.Declaration.variable(createId(), "x"),
          ),
        ),
      ).toBe(true);
      expect(
        Ast.isStatement(
          Ast.Statement.assign(
            createId(),
            Ast.Expression.identifier(createId(), "x"),
            Ast.Expression.literal(createId(), "number", "1"),
          ),
        ),
      ).toBe(true);
      expect(
        Ast.isStatement(Ast.Statement.controlFlow(createId(), "if", {})),
      ).toBe(true);
      expect(
        Ast.isStatement(
          Ast.Statement.express(
            createId(),
            Ast.Expression.identifier(createId(), "x"),
          ),
        ),
      ).toBe(true);

      expect(Ast.isStatement(Ast.Expression.identifier(createId(), "x"))).toBe(
        false,
      );
      expect(Ast.isStatement(Ast.block(createId(), "statements", []))).toBe(
        false,
      );
    });

    it("should identify type nodes", () => {
      expect(Ast.isType(Ast.Type.elementary(createId(), "uint", 256))).toBe(
        true,
      );
      expect(
        Ast.isType(
          Ast.Type.complex(createId(), "array", {
            typeArgs: [Ast.Type.elementary(createId(), "uint", 256)],
          }),
        ),
      ).toBe(true);
      expect(Ast.isType(Ast.Type.reference(createId(), "Point"))).toBe(true);

      expect(Ast.isType(Ast.Expression.identifier(createId(), "x"))).toBe(
        false,
      );
      expect(Ast.isType(Ast.block(createId(), "statements", []))).toBe(false);
    });

    it("should identify assignable expressions", () => {
      expect(
        Ast.Expression.isAssignable(Ast.Expression.identifier(createId(), "x")),
      ).toBe(true);
      expect(
        Ast.Expression.isAssignable(
          Ast.Expression.access(
            createId(),
            "member",
            Ast.Expression.identifier(createId(), "x"),
            "y",
          ),
        ),
      ).toBe(true);
      expect(
        Ast.Expression.isAssignable(
          Ast.Expression.access(
            createId(),
            "index",
            Ast.Expression.identifier(createId(), "x"),
            Ast.Expression.literal(createId(), "number", "0"),
          ),
        ),
      ).toBe(true);

      expect(
        Ast.Expression.isAssignable(
          Ast.Expression.literal(createId(), "number", "42"),
        ),
      ).toBe(false);
      expect(
        Ast.Expression.isAssignable(
          Ast.Expression.operator(createId(), "+", []),
        ),
      ).toBe(false);
      expect(
        Ast.Expression.isAssignable(
          Ast.Expression.call(
            createId(),
            Ast.Expression.identifier(createId(), "f"),
            [],
          ),
        ),
      ).toBe(false);
      expect(
        Ast.Expression.isAssignable(
          Ast.Expression.special(createId(), "msg.sender"),
        ),
      ).toBe(false);
    });
  });

  describe("Utility Functions", () => {
    describe("cloneNode", () => {
      it("should deep clone nodes", () => {
        const original = Ast.Expression.operator(createId(), "+", [
          Ast.Expression.identifier(createId(), "x"),
          Ast.Expression.literal(createId(), "number", "42"),
        ]);
        const clone = Ast.Node.clone(original);

        expect(clone).not.toBe(original);
        expect(clone.operands[0]).not.toBe(original.operands[0]);
        expect(clone.operands[1]).not.toBe(original.operands[1]);
        expect(clone).toEqual(original);
      });

      it("should handle complex nested structures", () => {
        const program = Ast.program(
          createId(),
          "Test",
          [
            Ast.Declaration.struct(createId(), "Point", [
              Ast.Declaration.field(
                createId(),
                "x",
                Ast.Type.elementary(createId(), "uint", 256),
              ),
              Ast.Declaration.field(
                createId(),
                "y",
                Ast.Type.elementary(createId(), "uint", 256),
              ),
            ]),
          ],
          Ast.block(createId(), "program", [
            Ast.Statement.controlFlow(createId(), "if", {
              condition: Ast.Expression.operator(createId(), "==", [
                Ast.Expression.special(createId(), "msg.sender"),
                Ast.Expression.identifier(createId(), "owner"),
              ]),
              body: Ast.block(createId(), "statements", [
                Ast.Statement.assign(
                  createId(),
                  Ast.Expression.identifier(createId(), "x"),
                  Ast.Expression.literal(createId(), "number", "42"),
                ),
              ]),
            }),
          ]),
          Ast.block(createId(), "program", []),
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
        const original = Ast.Expression.identifier(createId(), "x");
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
        createId(),
        "SimpleStorage",
        [
          // struct User { name: string; balance: uint256; }
          Ast.Declaration.struct(createId(), "User", [
            Ast.Declaration.field(
              createId(),
              "name",
              Ast.Type.elementary(createId(), "string"),
            ),
            Ast.Declaration.field(
              createId(),
              "balance",
              Ast.Type.elementary(createId(), "uint", 256),
            ),
          ]),

          // storage { 0: owner: address; 1: users: mapping<address, User>; }
          Ast.Declaration.storage(
            createId(),
            "owner",
            Ast.Type.elementary(createId(), "address"),
            0,
          ),
          Ast.Declaration.storage(
            createId(),
            "users",
            Ast.Type.complex(createId(), "mapping", {
              typeArgs: [
                Ast.Type.elementary(createId(), "address"),
                Ast.Type.reference(createId(), "User"),
              ],
            }),
            1,
          ),
        ],
        Ast.block(createId(), "program", [
          // let sender = msg.sender;
          Ast.Statement.declare(
            createId(),
            Ast.Declaration.variable(
              createId(),
              "sender",
              undefined,
              Ast.Expression.special(createId(), "msg.sender"),
            ),
          ),

          // if (sender == owner) { users[sender].balance = users[sender].balance + msg.value; }
          Ast.Statement.controlFlow(createId(), "if", {
            condition: Ast.Expression.operator(createId(), "==", [
              Ast.Expression.identifier(createId(), "sender"),
              Ast.Expression.identifier(createId(), "owner"),
            ]),
            body: Ast.block(createId(), "statements", [
              Ast.Statement.assign(
                createId(),
                Ast.Expression.access(
                  createId(),
                  "member",
                  Ast.Expression.access(
                    createId(),
                    "index",
                    Ast.Expression.identifier(createId(), "users"),
                    Ast.Expression.identifier(createId(), "sender"),
                  ),
                  "balance",
                ),
                Ast.Expression.operator(createId(), "+", [
                  Ast.Expression.access(
                    createId(),
                    "member",
                    Ast.Expression.access(
                      createId(),
                      "index",
                      Ast.Expression.identifier(createId(), "users"),
                      Ast.Expression.identifier(createId(), "sender"),
                    ),
                    "balance",
                  ),
                  Ast.Expression.special(createId(), "msg.value"),
                ]),
              ),
            ]),
          }),
        ]),
        Ast.block(createId(), "program", []),
      );

      expect(program.type).toBe("Program");
      expect(program.declarations).toHaveLength(3);
      expect(program.body?.items).toHaveLength(2);

      // Verify structure
      const structDecl = program.declarations[0];
      expect(structDecl.kind).toBe("struct");
      expect((structDecl as Ast.Declaration.Struct).fields).toHaveLength(2);

      const ifStmt = program.body?.items[1] as { type: string; kind?: string };
      expect(ifStmt.type).toBe("ControlFlowStatement");
      expect(ifStmt.kind).toBe("if");
    });
  });
});
