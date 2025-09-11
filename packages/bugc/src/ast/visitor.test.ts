import { describe, it, expect } from "vitest";

import * as Ast from "#ast";

// Helper to create test IDs
let testIdCounter = 0;
const createId = (): Ast.Id => `test-${testIdCounter++}` as Ast.Id;

describe("Visitor Pattern", () => {
  class TestVisitor implements Ast.Visitor<string, never> {
    program(node: Ast.Program): string {
      return `Program(${node.name})`;
    }
    declaration(node: Ast.Declaration): string {
      return `Declaration(${node.kind}:${node.name})`;
    }
    block(node: Ast.Block): string {
      return `Block(${node.kind})`;
    }
    elementaryType(node: { kind: string; bits?: number }): string {
      return `ElementaryType(${node.kind}${node.bits ? node.bits : ""})`;
    }
    complexType(node: { kind: string }): string {
      return `ComplexType(${node.kind})`;
    }
    referenceType(node: { name: string }): string {
      return `ReferenceType(${node.name})`;
    }
    declarationStatement(_node: Ast.Statement): string {
      return "DeclarationStatement";
    }
    assignmentStatement(_node: Ast.Statement): string {
      return "AssignmentStatement";
    }
    controlFlowStatement(node: { kind: string }): string {
      return `ControlFlowStatement(${node.kind})`;
    }
    expressionStatement(_node: Ast.Statement): string {
      return "ExpressionStatement";
    }
    identifierExpression(node: { name: string }): string {
      return `Identifier(${node.name})`;
    }
    literalExpression(node: { kind: string; value: string }): string {
      return `Literal(${node.kind}:${node.value})`;
    }
    operatorExpression(node: { operator: string }): string {
      return `Operator(${node.operator})`;
    }
    accessExpression(node: { kind: string }): string {
      return `Access(${node.kind})`;
    }
    callExpression(_node: Ast.Expression): string {
      return "Call";
    }
    specialExpression(node: { kind: string }): string {
      return `Special(${node.kind})`;
    }
    castExpression(_node: Ast.Expression): string {
      return "Cast";
    }
  }

  it("should visit all node types", () => {
    const visitor = new TestVisitor();

    expect(
      Ast.visit(
        visitor,
        Ast.program(
          createId(),
          "Test",
          [],
          Ast.block(createId(), "program", []),
          Ast.block(createId(), "program", []),
        ),
        undefined as never,
      ),
    ).toBe("Program(Test)");
    expect(
      Ast.visit(
        visitor,
        Ast.Declaration.variable(createId(), "x"),
        undefined as never,
      ),
    ).toBe("Declaration(variable:x)");
    expect(
      Ast.visit(
        visitor,
        Ast.block(createId(), "statements", []),
        undefined as never,
      ),
    ).toBe("Block(statements)");
    expect(
      Ast.visit(
        visitor,
        Ast.Type.elementary(createId(), "uint", 256),
        undefined as never,
      ),
    ).toBe("ElementaryType(uint256)");
    expect(
      Ast.visit(
        visitor,
        Ast.Type.complex(createId(), "array", {}),
        undefined as never,
      ),
    ).toBe("ComplexType(array)");
    expect(
      Ast.visit(
        visitor,
        Ast.Type.reference(createId(), "Point"),
        undefined as never,
      ),
    ).toBe("ReferenceType(Point)");
    expect(
      Ast.visit(
        visitor,
        Ast.Expression.identifier(createId(), "x"),
        undefined as never,
      ),
    ).toBe("Identifier(x)");
    expect(
      Ast.visit(
        visitor,
        Ast.Expression.literal(createId(), "number", "42"),
        undefined as never,
      ),
    ).toBe("Literal(number:42)");
    expect(
      Ast.visit(
        visitor,
        Ast.Expression.operator(createId(), "+", []),
        undefined as never,
      ),
    ).toBe("Operator(+)");
    expect(
      Ast.visit(
        visitor,
        Ast.Expression.access(
          createId(),
          "member",
          Ast.Expression.identifier(createId(), "x"),
          "y",
        ),
        undefined as never,
      ),
    ).toBe("Access(member)");
    expect(
      Ast.visit(
        visitor,
        Ast.Expression.call(
          createId(),
          Ast.Expression.identifier(createId(), "f"),
          [],
        ),
        undefined as never,
      ),
    ).toBe("Call");
    expect(
      Ast.visit(
        visitor,
        Ast.Expression.special(createId(), "msg.sender"),
        undefined as never,
      ),
    ).toBe("Special(msg.sender)");
    expect(
      Ast.visit(
        visitor,
        Ast.Statement.controlFlow(createId(), "if", {}),
        undefined as never,
      ),
    ).toBe("ControlFlowStatement(if)");
  });

  it("should throw on unknown node type", () => {
    const visitor = new TestVisitor();
    const badNode = { type: "Unknown", loc: null } as unknown as Ast.Node;

    expect(() => Ast.visit(visitor, badNode, undefined as never)).toThrow(
      "Unknown node type: Unknown",
    );
  });
});
