import { describe, it, expect } from "vitest";

import * as Ast from "#ast";

describe("Visitor Pattern", () => {
  class TestVisitor extends Ast.BaseVisitor<string> {
    visitProgram(node: Ast.Program): string {
      return `Program(${node.name})`;
    }
    visitDeclaration(node: Ast.Declaration): string {
      return `Declaration(${node.kind}:${node.name})`;
    }
    visitBlock(node: Ast.Block): string {
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
    visitDeclarationStatement(_node: Ast.Statement): string {
      return "DeclarationStatement";
    }
    visitAssignmentStatement(_node: Ast.Statement): string {
      return "AssignmentStatement";
    }
    visitControlFlowStatement(node: { kind: string }): string {
      return `ControlFlowStatement(${node.kind})`;
    }
    visitExpressionStatement(_node: Ast.Statement): string {
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
    visitCallExpression(_node: Ast.Expression): string {
      return "Call";
    }
    visitSpecialExpression(node: { kind: string }): string {
      return `Special(${node.kind})`;
    }
    visitCastExpression(_node: Ast.Expression): string {
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
    expect(visitor.visit(Ast.Type.elementary("uint", 256))).toBe(
      "ElementaryType(uint256)",
    );
    expect(visitor.visit(Ast.Type.complex("array", {}))).toBe(
      "ComplexType(array)",
    );
    expect(visitor.visit(Ast.Type.reference("Point"))).toBe(
      "ReferenceType(Point)",
    );
    expect(visitor.visit(Ast.Expression.identifier("x"))).toBe("Identifier(x)");
    expect(visitor.visit(Ast.Expression.literal("number", "42"))).toBe(
      "Literal(number:42)",
    );
    expect(visitor.visit(Ast.Expression.operator("+", []))).toBe("Operator(+)");
    expect(
      visitor.visit(
        Ast.Expression.access("member", Ast.Expression.identifier("x"), "y"),
      ),
    ).toBe("Access(member)");
    expect(
      visitor.visit(Ast.Expression.call(Ast.Expression.identifier("f"), [])),
    ).toBe("Call");
    expect(visitor.visit(Ast.Expression.special("msg.sender"))).toBe(
      "Special(msg.sender)",
    );
    expect(visitor.visit(Ast.Statement.controlFlow("if", {}))).toBe(
      "ControlFlowStatement(if)",
    );
  });

  it("should throw on unknown node type", () => {
    const visitor = new TestVisitor();
    const badNode = { type: "Unknown", loc: null } as unknown as Parameters<
      typeof visitor.visit
    >[0];

    expect(() => visitor.visit(badNode)).toThrow("Unknown node type: Unknown");
  });
});
