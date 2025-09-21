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
  arrayExpression(node: Ast.Expression.Array, context: C): T;
  structExpression(node: Ast.Expression.Struct, context: C): T;
  operatorExpression(node: Ast.Expression.Operator, context: C): T;
  accessExpression(node: Ast.Expression.Access, context: C): T;
  callExpression(node: Ast.Expression.Call, context: C): T;
  castExpression(node: Ast.Expression.Cast, context: C): T;
  specialExpression(node: Ast.Expression.Special, context: C): T;
}

// Base visitor implementation
export function visit<N extends Ast.Node, T, C = never>(
  visitor: Visitor<T, C>,
  node: N,
  context: C,
): T {
  switch (node.type) {
    case "Program":
      return visitor.program(node, context);
    case "Declaration":
      return visitor.declaration(node, context);
    case "Block":
      return visitor.block(node, context);
    case "ElementaryType":
      return visitor.elementaryType(node, context);
    case "ComplexType":
      return visitor.complexType(node, context);
    case "ReferenceType":
      return visitor.referenceType(node, context);
    case "DeclarationStatement":
      return visitor.declarationStatement(node, context);
    case "AssignmentStatement":
      return visitor.assignmentStatement(node, context);
    case "ControlFlowStatement":
      return visitor.controlFlowStatement(node, context);
    case "ExpressionStatement":
      return visitor.expressionStatement(node, context);
    case "IdentifierExpression":
      return visitor.identifierExpression(node, context);
    case "LiteralExpression":
      return visitor.literalExpression(node, context);
    case "ArrayExpression":
      return visitor.arrayExpression(node, context);
    case "StructExpression":
      return visitor.structExpression(node, context);
    case "OperatorExpression":
      return visitor.operatorExpression(node, context);
    case "AccessExpression":
      return visitor.accessExpression(node, context);
    case "CallExpression":
      return visitor.callExpression(node, context);
    case "CastExpression":
      return visitor.castExpression(node, context);
    case "SpecialExpression":
      return visitor.specialExpression(node, context);
    default:
      // @ts-expect-error switch statement should be exhaustive
      throw new Error(`Unknown node type: ${node.type}`);
  }
}
