import * as Ast from "#ast/spec";

export interface Visitor<T, C = never> {
  program(node: Ast.Program, context: C): T;
  declaration(node: Ast.Declaration, context: C): T;
  block(node: Ast.Block, context: C): T;
  elementaryType(node: Ast.Type.Elementary, context: C): T;
  complexType(node: Ast.Type.Complex, context: C): T;
  referenceType(node: Ast.Type.Reference, context: C): T;
  declarationStatement(node: Ast.Statement.Declare, context: C): T;
  assignmentStatement(node: Ast.Statement.Assign, context: C): T;
  controlFlowStatement(node: Ast.Statement.ControlFlow, context: C): T;
  expressionStatement(node: Ast.Statement.Express, context: C): T;
  identifierExpression(node: Ast.Expression.Identifier, context: C): T;
  literalExpression(node: Ast.Expression.Literal, context: C): T;
  operatorExpression(node: Ast.Expression.Operator, context: C): T;
  accessExpression(node: Ast.Expression.Access, context: C): T;
  callExpression(node: Ast.Expression.Call, context: C): T;
  castExpression(node: Ast.Expression.Cast, context: C): T;
  specialExpression(node: Ast.Expression.Special, context: C): T;
}

// Base visitor implementation
export function visit<T, C = never>(
  visitor: Visitor<T, C>,
  node: Ast.Node,
  context: C,
): T {
  switch (node.type) {
    case "Program":
      return visitor.program(node as Ast.Program, context);
    case "Declaration":
      return visitor.declaration(node as Ast.Declaration, context);
    case "Block":
      return visitor.block(node as Ast.Block, context);
    case "ElementaryType":
      return visitor.elementaryType(node as Ast.Type.Elementary, context);
    case "ComplexType":
      return visitor.complexType(node as Ast.Type.Complex, context);
    case "ReferenceType":
      return visitor.referenceType(node as Ast.Type.Reference, context);
    case "DeclarationStatement":
      return visitor.declarationStatement(
        node as Ast.Statement.Declare,
        context,
      );
    case "AssignmentStatement":
      return visitor.assignmentStatement(node as Ast.Statement.Assign, context);
    case "ControlFlowStatement":
      return visitor.controlFlowStatement(
        node as Ast.Statement.ControlFlow,
        context,
      );
    case "ExpressionStatement":
      return visitor.expressionStatement(
        node as Ast.Statement.Express,
        context,
      );
    case "IdentifierExpression":
      return visitor.identifierExpression(
        node as Ast.Expression.Identifier,
        context,
      );
    case "LiteralExpression":
      return visitor.literalExpression(node as Ast.Expression.Literal, context);
    case "OperatorExpression":
      return visitor.operatorExpression(
        node as Ast.Expression.Operator,
        context,
      );
    case "AccessExpression":
      return visitor.accessExpression(node as Ast.Expression.Access, context);
    case "CallExpression":
      return visitor.callExpression(node as Ast.Expression.Call, context);
    case "CastExpression":
      return visitor.castExpression(node as Ast.Expression.Cast, context);
    case "SpecialExpression":
      return visitor.specialExpression(node as Ast.Expression.Special, context);
    default:
      throw new Error(`Unknown node type: ${node.type}`);
  }
}
