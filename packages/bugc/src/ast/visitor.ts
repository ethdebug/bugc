import * as Ast from "#ast/spec";

export interface Visitor<T> {
  visitProgram(node: Ast.Program): T;
  visitDeclaration(node: Ast.Declaration): T;
  visitBlock(node: Ast.Block): T;
  visitElementaryType(node: Ast.Type.Elementary): T;
  visitComplexType(node: Ast.Type.Complex): T;
  visitReferenceType(node: Ast.Type.Reference): T;
  visitDeclarationStatement(node: Ast.Statement.Declare): T;
  visitAssignmentStatement(node: Ast.Statement.Assign): T;
  visitControlFlowStatement(node: Ast.Statement.ControlFlow): T;
  visitExpressionStatement(node: Ast.Statement.Express): T;
  visitIdentifierExpression(node: Ast.Expression.Identifier): T;
  visitLiteralExpression(node: Ast.Expression.Literal): T;
  visitOperatorExpression(node: Ast.Expression.Operator): T;
  visitAccessExpression(node: Ast.Expression.Access): T;
  visitCallExpression(node: Ast.Expression.Call): T;
  visitCastExpression(node: Ast.Expression.Cast): T;
  visitSpecialExpression(node: Ast.Expression.Special): T;
}

// Base visitor implementation
export abstract class BaseVisitor<T> implements Visitor<T> {
  visit(node: Ast.Node): T {
    switch (node.type) {
      case "Program":
        return this.visitProgram(node as Ast.Program);
      case "Declaration":
        return this.visitDeclaration(node as Ast.Declaration);
      case "Block":
        return this.visitBlock(node as Ast.Block);
      case "ElementaryType":
        return this.visitElementaryType(node as Ast.Type.Elementary);
      case "ComplexType":
        return this.visitComplexType(node as Ast.Type.Complex);
      case "ReferenceType":
        return this.visitReferenceType(node as Ast.Type.Reference);
      case "DeclarationStatement":
        return this.visitDeclarationStatement(node as Ast.Statement.Declare);
      case "AssignmentStatement":
        return this.visitAssignmentStatement(node as Ast.Statement.Assign);
      case "ControlFlowStatement":
        return this.visitControlFlowStatement(
          node as Ast.Statement.ControlFlow,
        );
      case "ExpressionStatement":
        return this.visitExpressionStatement(node as Ast.Statement.Express);
      case "IdentifierExpression":
        return this.visitIdentifierExpression(
          node as Ast.Expression.Identifier,
        );
      case "LiteralExpression":
        return this.visitLiteralExpression(node as Ast.Expression.Literal);
      case "OperatorExpression":
        return this.visitOperatorExpression(node as Ast.Expression.Operator);
      case "AccessExpression":
        return this.visitAccessExpression(node as Ast.Expression.Access);
      case "CallExpression":
        return this.visitCallExpression(node as Ast.Expression.Call);
      case "CastExpression":
        return this.visitCastExpression(node as Ast.Expression.Cast);
      case "SpecialExpression":
        return this.visitSpecialExpression(node as Ast.Expression.Special);
      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }
  }

  abstract visitProgram(node: Ast.Program): T;
  abstract visitDeclaration(node: Ast.Declaration): T;
  abstract visitBlock(node: Ast.Block): T;
  abstract visitElementaryType(node: Ast.Type.Elementary): T;
  abstract visitComplexType(node: Ast.Type.Complex): T;
  abstract visitReferenceType(node: Ast.Type.Reference): T;
  abstract visitDeclarationStatement(node: Ast.Statement.Declare): T;
  abstract visitAssignmentStatement(node: Ast.Statement.Assign): T;
  abstract visitControlFlowStatement(node: Ast.Statement.ControlFlow): T;
  abstract visitExpressionStatement(node: Ast.Statement.Express): T;
  abstract visitIdentifierExpression(node: Ast.Expression.Identifier): T;
  abstract visitLiteralExpression(node: Ast.Expression.Literal): T;
  abstract visitOperatorExpression(node: Ast.Expression.Operator): T;
  abstract visitAccessExpression(node: Ast.Expression.Access): T;
  abstract visitCallExpression(node: Ast.Expression.Call): T;
  abstract visitCastExpression(node: Ast.Expression.Cast): T;
  abstract visitSpecialExpression(node: Ast.Expression.Special): T;
}
