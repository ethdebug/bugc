/**
 * Normalized AST node types for the BUG language
 *
 * Aligned with ethdebug format domain language for compatibility
 * with debugging tooling and standardization.
 *
 * Key principles:
 * 1. Unified patterns for similar constructs (declarations, blocks, etc.)
 * 2. Use discriminated unions with 'kind' fields for variants
 * 3. Minimize special cases
 * 4. Clear separation between syntactic and semantic information
 * 5. Alignment with ethdebug format terminology and structure
 */

// Base types

export interface SourceLocation {
  offset: number;
  length: number;
}

export interface AstNode {
  type: string;
  loc: SourceLocation | null;
  parent?: AstNode; // Parent reference for traversal
}

// Program structure

export interface Program extends AstNode {
  type: "Program";
  name: string;
  declarations: Declaration[]; // All top-level declarations
  create: Block; // Constructor code block (may be empty)
  body: Block; // Runtime code block (may be empty)
}

// Unified Declaration pattern
// Covers: struct declarations, field declarations, storage declarations, and variable declarations

export interface Declaration extends AstNode {
  type: "Declaration";
  kind: "struct" | "field" | "storage" | "variable" | "function";
  name: string;
  declaredType?: TypeNode;
  initializer?: Expression;
  metadata?: DeclarationMetadata;
}

export interface DeclarationMetadata {
  slot?: number; // For storage declarations
  fields?: Declaration[]; // For struct declarations
  parameters?: FunctionParameter[]; // For function declarations
  body?: Block; // For function declarations
  visibility?: "public" | "private"; // Future extension
  location?: DataLocation; // Where the data is stored
}

export interface FunctionParameter {
  name: string;
  type: TypeNode;
}

// Data locations aligned with ethdebug format
export type DataLocation =
  | "storage"
  | "memory"
  | "stack"
  | "calldata"
  | "returndata"
  | "transient"
  | "code";

// Unified Block pattern
// Covers: code blocks, storage blocks, statement blocks

export interface Block extends AstNode {
  type: "Block";
  kind: "program" | "storage" | "statements" | "struct-body" | "define";
  items: (Statement | Declaration)[];
}

// Type nodes - aligned with ethdebug format

export type TypeNode = ElementaryType | ComplexType | ReferenceType;

// Elementary types aligned with ethdebug format
export interface ElementaryType extends AstNode {
  type: "ElementaryType";
  kind: ElementaryTypeKind;
  bits?: number; // For numeric and bytes types
}

export type ElementaryTypeKind =
  | "uint"
  | "int"
  | "address"
  | "bool"
  | "bytes"
  | "string"
  | "fixed"
  | "ufixed";

// Complex types (renamed from CompositeType)
export interface ComplexType extends AstNode {
  type: "ComplexType";
  kind: ComplexTypeKind;
  typeArgs?: TypeNode[]; // For array, mapping
  size?: number; // For fixed-size arrays
  members?: Declaration[]; // For struct, tuple
  parameters?: TypeNode[]; // For function types
  returns?: TypeNode[]; // For function types
  base?: TypeNode; // For alias types
}

export type ComplexTypeKind =
  | "array"
  | "mapping"
  | "struct"
  | "tuple"
  | "function"
  | "alias"
  | "contract"
  | "enum";

export interface ReferenceType extends AstNode {
  type: "ReferenceType";
  name: string;
}

// Statements - unified pattern

export type Statement =
  | DeclarationStatement
  | AssignmentStatement
  | ControlFlowStatement
  | ExpressionStatement;

export interface DeclarationStatement extends AstNode {
  type: "DeclarationStatement";
  declaration: Declaration;
}

export interface AssignmentStatement extends AstNode {
  type: "AssignmentStatement";
  target: Expression; // Must be assignable (validated during semantic analysis)
  value: Expression;
  operator?: string; // For compound assignments like += (future)
}

export interface ControlFlowStatement extends AstNode {
  type: "ControlFlowStatement";
  kind: "if" | "for" | "while" | "return" | "break" | "continue";

  // Different control flow statements use different subsets of these
  condition?: Expression;
  body?: Block;
  alternate?: Block; // For if-else
  init?: Statement; // For for-loops
  update?: Statement; // For for-loops
  value?: Expression; // For return
  label?: string; // For break/continue (future)
}

export interface ExpressionStatement extends AstNode {
  type: "ExpressionStatement";
  expression: Expression;
}

// Expressions - normalized hierarchy

export type Expression =
  | IdentifierExpression
  | LiteralExpression
  | OperatorExpression
  | AccessExpression
  | CallExpression
  | CastExpression
  | SpecialExpression;

export interface IdentifierExpression extends AstNode {
  type: "IdentifierExpression";
  name: string;
}

export interface LiteralExpression extends AstNode {
  type: "LiteralExpression";
  kind: "number" | "string" | "boolean" | "address" | "hex";
  value: string; // Always store as string for precision
  unit?: string; // For wei/ether/finney on numbers
}

export interface OperatorExpression extends AstNode {
  type: "OperatorExpression";
  operator: string;
  operands: Expression[];
  // Arity is implicit from operands.length
}

export interface AccessExpression extends AstNode {
  type: "AccessExpression";
  kind: "member" | "index" | "slice";
  object: Expression;
  property: Expression | string; // string for member access, expression for index
  end?: Expression; // For slice access, the end index
}

export interface CallExpression extends AstNode {
  type: "CallExpression";
  callee: Expression;
  arguments: Expression[];
}

export interface CastExpression extends AstNode {
  type: "CastExpression";
  expression: Expression;
  targetType: TypeNode;
}

export interface SpecialExpression extends AstNode {
  type: "SpecialExpression";
  kind:
    | "msg.sender"
    | "msg.value"
    | "msg.data"
    | "block.timestamp"
    | "block.number";
  // Extensible for other special values
}

// Visitor pattern support

export interface AstVisitor<T> {
  visitProgram(node: Program): T;
  visitDeclaration(node: Declaration): T;
  visitBlock(node: Block): T;
  visitElementaryType(node: ElementaryType): T;
  visitComplexType(node: ComplexType): T;
  visitReferenceType(node: ReferenceType): T;
  visitDeclarationStatement(node: DeclarationStatement): T;
  visitAssignmentStatement(node: AssignmentStatement): T;
  visitControlFlowStatement(node: ControlFlowStatement): T;
  visitExpressionStatement(node: ExpressionStatement): T;
  visitIdentifierExpression(node: IdentifierExpression): T;
  visitLiteralExpression(node: LiteralExpression): T;
  visitOperatorExpression(node: OperatorExpression): T;
  visitAccessExpression(node: AccessExpression): T;
  visitCallExpression(node: CallExpression): T;
  visitCastExpression(node: CastExpression): T;
  visitSpecialExpression(node: SpecialExpression): T;
}

// Base visitor implementation
export abstract class BaseAstVisitor<T> implements AstVisitor<T> {
  visit(node: AstNode): T {
    switch (node.type) {
      case "Program":
        return this.visitProgram(node as Program);
      case "Declaration":
        return this.visitDeclaration(node as Declaration);
      case "Block":
        return this.visitBlock(node as Block);
      case "ElementaryType":
        return this.visitElementaryType(node as ElementaryType);
      case "ComplexType":
        return this.visitComplexType(node as ComplexType);
      case "ReferenceType":
        return this.visitReferenceType(node as ReferenceType);
      case "DeclarationStatement":
        return this.visitDeclarationStatement(node as DeclarationStatement);
      case "AssignmentStatement":
        return this.visitAssignmentStatement(node as AssignmentStatement);
      case "ControlFlowStatement":
        return this.visitControlFlowStatement(node as ControlFlowStatement);
      case "ExpressionStatement":
        return this.visitExpressionStatement(node as ExpressionStatement);
      case "IdentifierExpression":
        return this.visitIdentifierExpression(node as IdentifierExpression);
      case "LiteralExpression":
        return this.visitLiteralExpression(node as LiteralExpression);
      case "OperatorExpression":
        return this.visitOperatorExpression(node as OperatorExpression);
      case "AccessExpression":
        return this.visitAccessExpression(node as AccessExpression);
      case "CallExpression":
        return this.visitCallExpression(node as CallExpression);
      case "CastExpression":
        return this.visitCastExpression(node as CastExpression);
      case "SpecialExpression":
        return this.visitSpecialExpression(node as SpecialExpression);
      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }
  }

  abstract visitProgram(node: Program): T;
  abstract visitDeclaration(node: Declaration): T;
  abstract visitBlock(node: Block): T;
  abstract visitElementaryType(node: ElementaryType): T;
  abstract visitComplexType(node: ComplexType): T;
  abstract visitReferenceType(node: ReferenceType): T;
  abstract visitDeclarationStatement(node: DeclarationStatement): T;
  abstract visitAssignmentStatement(node: AssignmentStatement): T;
  abstract visitControlFlowStatement(node: ControlFlowStatement): T;
  abstract visitExpressionStatement(node: ExpressionStatement): T;
  abstract visitIdentifierExpression(node: IdentifierExpression): T;
  abstract visitLiteralExpression(node: LiteralExpression): T;
  abstract visitOperatorExpression(node: OperatorExpression): T;
  abstract visitAccessExpression(node: AccessExpression): T;
  abstract visitCallExpression(node: CallExpression): T;
  abstract visitCastExpression(node: CastExpression): T;
  abstract visitSpecialExpression(node: SpecialExpression): T;
}

// Exhaustive type checking utility
export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${x}`);
}

// Type guards

export function isExpression(node: AstNode): node is Expression {
  return [
    "IdentifierExpression",
    "LiteralExpression",
    "OperatorExpression",
    "AccessExpression",
    "CallExpression",
    "CastExpression",
    "SpecialExpression",
  ].includes(node.type);
}

export function isStatement(node: AstNode): node is Statement {
  return [
    "DeclarationStatement",
    "AssignmentStatement",
    "ControlFlowStatement",
    "ExpressionStatement",
  ].includes(node.type);
}

export function isTypeNode(node: AstNode): node is TypeNode {
  return ["ElementaryType", "ComplexType", "ReferenceType"].includes(node.type);
}

export function isAssignable(expr: Expression): boolean {
  // Only certain expressions can be assigned to
  return (
    expr.type === "IdentifierExpression" || expr.type === "AccessExpression"
  );
}

// Factory functions for cleaner node creation

export const Ast = {
  program(
    name: string,
    declarations: Declaration[],
    body: Block,
    create: Block,
    loc?: SourceLocation,
  ): Program {
    return {
      type: "Program",
      name,
      declarations,
      body,
      create,
      loc: loc ?? null,
    };
  },

  declaration(
    kind: Declaration["kind"],
    name: string,
    declaredType?: TypeNode,
    initializer?: Expression,
    metadata?: DeclarationMetadata,
    loc?: SourceLocation,
  ): Declaration {
    return {
      type: "Declaration",
      kind,
      name,
      declaredType,
      initializer,
      metadata,
      loc: loc ?? null,
    };
  },

  block(
    kind: Block["kind"],
    items: (Statement | Declaration)[],
    loc?: SourceLocation,
  ): Block {
    return { type: "Block", kind, items, loc: loc ?? null };
  },

  elementaryType(
    kind: ElementaryTypeKind,
    bits?: number,
    loc?: SourceLocation,
  ): ElementaryType {
    return { type: "ElementaryType", kind, bits, loc: loc ?? null };
  },

  complexType(
    kind: ComplexTypeKind,
    options?: {
      typeArgs?: TypeNode[];
      size?: number;
      members?: Declaration[];
      parameters?: TypeNode[];
      returns?: TypeNode[];
      base?: TypeNode;
    },
    loc?: SourceLocation,
  ): ComplexType {
    return { type: "ComplexType", kind, ...options, loc: loc ?? null };
  },

  referenceType(name: string, loc?: SourceLocation): ReferenceType {
    return { type: "ReferenceType", name, loc: loc ?? null };
  },

  identifier(name: string, loc?: SourceLocation): IdentifierExpression {
    return { type: "IdentifierExpression", name, loc: loc ?? null };
  },

  literal(
    kind: LiteralExpression["kind"],
    value: string,
    unit?: string,
    loc?: SourceLocation,
  ): LiteralExpression {
    return { type: "LiteralExpression", kind, value, unit, loc: loc ?? null };
  },

  operator(
    operator: string,
    operands: Expression[],
    loc?: SourceLocation,
  ): OperatorExpression {
    return { type: "OperatorExpression", operator, operands, loc: loc ?? null };
  },

  access(
    kind: AccessExpression["kind"],
    object: Expression,
    property: Expression | string,
    end?: Expression,
    loc?: SourceLocation,
  ): AccessExpression {
    const node: AccessExpression = {
      type: "AccessExpression",
      kind,
      object,
      property,
      loc: loc ?? null,
    };
    if (end !== undefined) {
      node.end = end;
    }
    return node;
  },

  call(
    callee: Expression,
    args: Expression[],
    loc?: SourceLocation,
  ): CallExpression {
    return {
      type: "CallExpression",
      callee,
      arguments: args,
      loc: loc ?? null,
    };
  },

  cast(
    expression: Expression,
    targetType: TypeNode,
    loc?: SourceLocation,
  ): CastExpression {
    return {
      type: "CastExpression",
      expression,
      targetType,
      loc: loc ?? null,
    };
  },

  special(
    kind: SpecialExpression["kind"],
    loc?: SourceLocation,
  ): SpecialExpression {
    return { type: "SpecialExpression", kind, loc: loc ?? null };
  },

  declarationStmt(
    declaration: Declaration,
    loc?: SourceLocation,
  ): DeclarationStatement {
    return { type: "DeclarationStatement", declaration, loc: loc ?? null };
  },

  assignment(
    target: Expression,
    value: Expression,
    operator?: string,
    loc?: SourceLocation,
  ): AssignmentStatement {
    return {
      type: "AssignmentStatement",
      target,
      value,
      operator,
      loc: loc ?? null,
    };
  },

  controlFlow(
    kind: ControlFlowStatement["kind"],
    options: Partial<ControlFlowStatement>,
    loc?: SourceLocation,
  ): ControlFlowStatement {
    return { type: "ControlFlowStatement", kind, ...options, loc: loc ?? null };
  },

  expressionStmt(
    expression: Expression,
    loc?: SourceLocation,
  ): ExpressionStatement {
    return { type: "ExpressionStatement", expression, loc: loc ?? null };
  },
};

// Helper functions for creating common elementary types
export const ElementaryTypes = {
  uint(bits: number = 256): ElementaryType {
    return Ast.elementaryType("uint", bits);
  },
  int(bits: number = 256): ElementaryType {
    return Ast.elementaryType("int", bits);
  },
  bool(): ElementaryType {
    return Ast.elementaryType("bool");
  },
  address(): ElementaryType {
    return Ast.elementaryType("address");
  },
  bytes(bits?: number): ElementaryType {
    return Ast.elementaryType("bytes", bits);
  },
  string(): ElementaryType {
    return Ast.elementaryType("string");
  },
  fixed(bits: number = 128): ElementaryType {
    return Ast.elementaryType("fixed", bits);
  },
  ufixed(bits: number = 128): ElementaryType {
    return Ast.elementaryType("ufixed", bits);
  },
};

// Utility functions

export function cloneNode<T extends AstNode>(node: T): T {
  const clone = { ...node };
  delete clone.parent; // Don't clone parent references

  // Deep clone child nodes
  for (const [key, value] of Object.entries(clone)) {
    if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        (clone as Record<string, unknown>)[key] = value.map((item) =>
          item && typeof item === "object" && "type" in item
            ? cloneNode(item)
            : item,
        );
      } else if ("type" in value) {
        (clone as Record<string, unknown>)[key] = cloneNode(value);
      }
    }
  }

  return clone;
}

export function updateNode<T extends AstNode>(node: T, updates: Partial<T>): T {
  return { ...node, ...updates };
}

// Walker utility for setting parent references
export function setParentReferences(root: AstNode, parent?: AstNode): void {
  root.parent = parent;

  for (const [key, value] of Object.entries(root)) {
    // Skip parent reference to avoid circular traversal
    if (key === "parent") continue;

    if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (item && typeof item === "object" && "type" in item) {
            setParentReferences(item, root);
          }
        });
      } else if ("type" in value) {
        setParentReferences(value as AstNode, root);
      }
    }
  }
}
