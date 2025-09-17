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

export interface SourceLocation {
  offset: number;
  length: number;
}

export const isSourceLocation = (loc: unknown): loc is SourceLocation =>
  typeof loc === "object" &&
  !!loc &&
  "offset" in loc &&
  typeof loc.offset === "number" &&
  loc.offset >= 0 &&
  "length" in loc &&
  typeof loc.length === "number" &&
  loc.length >= 0;

// ID type for AST nodes - using string type with numeric identifiers
export type Id = string;

export type Node =
  | Program
  | Declaration
  | Block
  | Type
  | Statement
  | Expression;

export namespace Node {
  export interface Base {
    id: Id;
    type: string;
    loc: SourceLocation | null;
  }

  export const isBase = (node: unknown): node is Node.Base =>
    typeof node === "object" &&
    !!node &&
    "id" in node &&
    typeof node.id === "string" &&
    "type" in node &&
    typeof node.type === "string" &&
    !!node.type &&
    "loc" in node &&
    (node.loc === null || isSourceLocation(node.loc));

  export function clone<T extends Node>(node: T): T {
    const clone = { ...node };

    // Deep clone child nodes
    for (const [key, value] of Object.entries(clone)) {
      if (value && typeof value === "object") {
        if (Array.isArray(value)) {
          (clone as unknown as Record<string, unknown>)[key] = value.map(
            (item) =>
              item && typeof item === "object" && "type" in item
                ? Node.clone(item)
                : item,
          );
        } else if ("type" in value) {
          (clone as unknown as Record<string, unknown>)[key] =
            Node.clone(value);
        }
      }
    }

    return clone;
  }

  export function update<T extends Node>(node: T, updates: Partial<T>): T {
    return { ...node, ...updates };
  }
}

// Program structure

export interface Program extends Node.Base {
  type: "Program";
  name: string;
  declarations: Declaration[]; // All top-level declarations
  create?: Block; // Constructor code block (may be empty)
  body?: Block; // Runtime code block (may be empty)
}

export function program(
  id: Id,
  name: string,
  declarations: Declaration[],
  body: Block,
  create: Block,
  loc?: SourceLocation,
): Program {
  return {
    id,
    type: "Program",
    name,
    declarations,
    body,
    create,
    loc: loc ?? null,
  };
}

export const isProgram = (program: unknown): program is Program =>
  Node.isBase(program) &&
  program.type === "Program" &&
  "name" in program &&
  typeof program.name === "string" &&
  "declarations" in program &&
  Array.isArray(program.declarations) &&
  program.declarations.every(isDeclaration); //&&
// "create" in program && isBlock(program.create) &&
// "body" in program && isBlock(program.body);

export type Declaration =
  | Declaration.Struct
  | Declaration.Field
  | Declaration.Storage
  | Declaration.Variable
  | Declaration.Function;

export const isDeclaration = (node: unknown): node is Declaration =>
  Declaration.isBase(node) &&
  [
    Declaration.isStruct,
    Declaration.isField,
    Declaration.isStorage,
    Declaration.isVariable,
    Declaration.isFunction,
  ].some((guard) => guard(node));

export namespace Declaration {
  export interface Base extends Node.Base {
    type: "Declaration";
    name: string;
  }

  export const isBase = (
    declaration: unknown,
  ): declaration is Declaration.Base =>
    Node.isBase(declaration) &&
    declaration.type === "Declaration" &&
    "name" in declaration &&
    typeof declaration.name === "string";

  export interface Struct extends Declaration.Base {
    kind: "struct";
    fields: Declaration[];
  }

  export function struct(
    id: Id,
    name: string,
    fields: Declaration.Field[],
    loc?: SourceLocation,
  ): Declaration.Struct {
    return {
      id,
      kind: "struct",
      type: "Declaration",
      name,
      fields,
      loc: loc ?? null,
    };
  }

  export const isStruct = (
    declaration: Declaration.Base,
  ): declaration is Declaration.Struct =>
    "kind" in declaration && declaration.kind === "struct";

  export interface Field extends Declaration.Base {
    kind: "field";
    declaredType?: Type;
    initializer?: Expression;
  }

  export function field(
    id: Id,
    name: string,
    declaredType?: Type,
    initializer?: Expression,
    loc?: SourceLocation,
  ): Declaration.Field {
    return {
      id,
      kind: "field",
      type: "Declaration",
      name,
      declaredType,
      initializer,
      loc: loc ?? null,
    };
  }

  export const isField = (
    declaration: Declaration.Base,
  ): declaration is Declaration.Field =>
    "kind" in declaration && declaration.kind === "field";

  export interface Storage extends Declaration.Base {
    kind: "storage";
    declaredType: Type;
    slot: number;
  }

  export function storage(
    id: Id,
    name: string,
    declaredType: Type,
    slot: number,
    loc?: SourceLocation,
  ): Declaration.Storage {
    return {
      id,
      kind: "storage",
      type: "Declaration",
      name,
      declaredType,
      slot,
      loc: loc ?? null,
    };
  }

  export const isStorage = (
    declaration: Declaration.Base,
  ): declaration is Declaration.Storage =>
    "kind" in declaration && declaration.kind === "storage";

  export interface Variable extends Declaration.Base {
    kind: "variable";
    declaredType?: Type;
    initializer?: Expression;
  }

  export function variable(
    id: Id,
    name: string,
    declaredType?: Type,
    initializer?: Expression,
    loc?: SourceLocation,
  ): Declaration.Variable {
    return {
      id,
      kind: "variable",
      type: "Declaration",
      name,
      declaredType,
      initializer,
      loc: loc ?? null,
    };
  }

  export const isVariable = (
    declaration: Declaration.Base,
  ): declaration is Declaration.Variable =>
    "kind" in declaration && declaration.kind === "variable";

  export interface Function extends Declaration.Base {
    kind: "function";
    parameters: FunctionParameter[];
    returnType?: Type;
    body: Block;
  }

  export function function_(
    id: Id,
    name: string,
    parameters: FunctionParameter[],
    returnType: Type | undefined,
    body: Block,
    loc?: SourceLocation,
  ): Declaration.Function {
    return {
      id,
      kind: "function",
      type: "Declaration",
      name,
      parameters,
      returnType,
      body,
      loc: loc ?? null,
    };
  }

  export const isFunction = (
    declaration: Declaration.Base,
  ): declaration is Declaration.Function =>
    "kind" in declaration && declaration.kind === "function";
}

export interface FunctionParameter {
  name: string;
  type: Type;
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

export interface Block extends Node.Base {
  type: "Block";
  kind: "program" | "storage" | "statements" | "struct-body" | "define";
  items: (Statement | Declaration)[];
}

export function block(
  id: Id,
  kind: Block["kind"],
  items: (Statement | Declaration)[],
  loc?: SourceLocation,
): Block {
  return { id, type: "Block", kind, items, loc: loc ?? null };
}

// Type nodes - aligned with ethdebug format

export type Type = Type.Elementary | Type.Complex | Type.Reference;

export function isType(node: Node): node is Type {
  return ["ElementaryType", "ComplexType", "ReferenceType"].includes(node.type);
}

export namespace Type {
  // Elementary types aligned with ethdebug format
  export interface Elementary extends Node.Base {
    type: "ElementaryType";
    kind: Type.Elementary.Kind;
    bits?: number; // For numeric and bytes types
  }

  export function elementary(
    id: Id,
    kind: Type.Elementary.Kind,
    bits?: number,
    loc?: SourceLocation,
  ): Type.Elementary {
    return { id, type: "ElementaryType", kind, bits, loc: loc ?? null };
  }

  export function complex(
    id: Id,
    kind: Type.Complex.Kind,
    options?: {
      typeArgs?: Type[];
      size?: number;
      members?: Declaration[];
      parameters?: Type[];
      returns?: Type[];
      base?: Type;
    },
    loc?: SourceLocation,
  ): Type.Complex {
    return { id, type: "ComplexType", kind, ...options, loc: loc ?? null };
  }

  export function reference(
    id: Id,
    name: string,
    loc?: SourceLocation,
  ): Type.Reference {
    return { id, type: "ReferenceType", name, loc: loc ?? null };
  }

  export namespace Elementary {
    export type Kind =
      | "uint"
      | "int"
      | "address"
      | "bool"
      | "bytes"
      | "string"
      | "fixed"
      | "ufixed";
  }

  export function uint(id: Id, bits: number = 256): Type.Elementary {
    return Type.elementary(id, "uint", bits);
  }
  export function int(id: Id, bits: number = 256): Type.Elementary {
    return Type.elementary(id, "int", bits);
  }
  export function bool(id: Id): Type.Elementary {
    return Type.elementary(id, "bool");
  }
  export function address(id: Id): Type.Elementary {
    return Type.elementary(id, "address");
  }
  export function bytes(id: Id, bits?: number): Type.Elementary {
    return Type.elementary(id, "bytes", bits);
  }
  export function string(id: Id): Type.Elementary {
    return Type.elementary(id, "string");
  }
  export function fixed(id: Id, bits: number = 128): Type.Elementary {
    return Type.elementary(id, "fixed", bits);
  }
  export function ufixed(id: Id, bits: number = 128): Type.Elementary {
    return Type.elementary(id, "ufixed", bits);
  }

  export interface Complex extends Node.Base {
    type: "ComplexType";
    kind: Type.Complex.Kind;
    typeArgs?: Type[]; // For array, mapping
    size?: number; // For fixed-size arrays
    members?: Declaration[]; // For struct, tuple
    parameters?: Type[]; // For function types
    returns?: Type[]; // For function types
    base?: Type; // For alias types
  }

  export namespace Complex {
    export type Kind =
      | "array"
      | "mapping"
      | "struct"
      | "tuple"
      | "function"
      | "alias"
      | "contract"
      | "enum";
  }

  export interface Reference extends Node.Base {
    type: "ReferenceType";
    name: string;
  }
}

// Statements - unified pattern

export type Statement =
  | Statement.Declare
  | Statement.Assign
  | Statement.ControlFlow
  | Statement.Express;

export function isStatement(node: Node): node is Statement {
  return [
    "DeclarationStatement",
    "AssignmentStatement",
    "ControlFlowStatement",
    "ExpressionStatement",
  ].includes(node.type);
}

export namespace Statement {
  export interface Declare extends Node.Base {
    type: "DeclarationStatement";
    declaration: Declaration;
  }

  export function declare(
    id: Id,
    declaration: Declaration,
    loc?: SourceLocation,
  ): Statement.Declare {
    return { id, type: "DeclarationStatement", declaration, loc: loc ?? null };
  }

  export interface Assign extends Node.Base {
    type: "AssignmentStatement";
    target: Expression; // Must be assignable (validated during semantic analysis)
    value: Expression;
    operator?: string; // For compound assignments like += (future)
  }

  export function assign(
    id: Id,
    target: Expression,
    value: Expression,
    operator?: string,
    loc?: SourceLocation,
  ): Statement.Assign {
    return {
      id,
      type: "AssignmentStatement",
      target,
      value,
      operator,
      loc: loc ?? null,
    };
  }

  export interface ControlFlow extends Node.Base {
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

  export function controlFlow(
    id: Id,
    kind: Statement.ControlFlow["kind"],
    options: Partial<Statement.ControlFlow>,
    loc?: SourceLocation,
  ): Statement.ControlFlow {
    return {
      id,
      type: "ControlFlowStatement",
      kind,
      ...options,
      loc: loc ?? null,
    };
  }

  export interface Express extends Node.Base {
    type: "ExpressionStatement";
    expression: Expression;
  }

  export function express(
    id: Id,
    expression: Expression,
    loc?: SourceLocation,
  ): Statement.Express {
    return { id, type: "ExpressionStatement", expression, loc: loc ?? null };
  }
}

// Expressions - normalized hierarchy

export type Expression =
  | Expression.Identifier
  | Expression.Literal
  | Expression.Operator
  | Expression.Access
  | Expression.Call
  | Expression.Cast
  | Expression.Special;

export const isExpression = (node: unknown): node is Expression =>
  Node.isBase(node) &&
  [
    Expression.isIdentifier,
    Expression.isLiteral,
    Expression.isOperator,
    Expression.isAccess,
    Expression.isCall,
    Expression.isCast,
    Expression.isSpecial,
  ].some((guard) => guard(node));

export namespace Expression {
  export function isAssignable(expr: Expression): boolean {
    // Only certain expressions can be assigned to
    return (
      expr.type === "IdentifierExpression" || expr.type === "AccessExpression"
    );
  }

  export interface Identifier extends Node.Base {
    type: "IdentifierExpression";
    name: string;
  }

  export const isIdentifier = (
    expression: Node.Base,
  ): expression is Expression.Identifier =>
    expression.type === "IdentifierExpression" &&
    "name" in expression &&
    typeof expression.name === "string";

  export function identifier(
    id: Id,
    name: string,
    loc?: SourceLocation,
  ): Expression.Identifier {
    return { id, type: "IdentifierExpression", name, loc: loc ?? null };
  }

  export interface Literal extends Node.Base {
    type: "LiteralExpression";
    kind: "number" | "string" | "boolean" | "address" | "hex";
    value: string; // Always store as string for precision
    unit?: string; // For wei/ether/finney on numbers
  }

  export const isLiteral = (
    expression: Node.Base,
  ): expression is Expression.Literal =>
    expression.type === "LiteralExpression" &&
    "kind" in expression &&
    typeof expression.kind === "string" &&
    "value" in expression &&
    typeof expression.value === "string";

  export function literal(
    id: Id,
    kind: Expression.Literal["kind"],
    value: string,
    unit?: string,
    loc?: SourceLocation,
  ): Expression.Literal {
    return {
      id,
      type: "LiteralExpression",
      kind,
      value,
      unit,
      loc: loc ?? null,
    };
  }

  export interface Operator extends Node.Base {
    type: "OperatorExpression";
    operator: string;
    operands: Expression[];
    // Arity is implicit from operands.length
  }

  export const isOperator = (
    expression: Node.Base,
  ): expression is Expression.Operator =>
    expression.type === "OperatorExpression" &&
    "operator" in expression &&
    typeof expression.operator === "string" &&
    "operands" in expression &&
    Array.isArray(expression.operands);

  export function operator(
    id: Id,
    operator: string,
    operands: Expression[],
    loc?: SourceLocation,
  ): Expression.Operator {
    return {
      id,
      type: "OperatorExpression",
      operator,
      operands,
      loc: loc ?? null,
    };
  }

  export type Access =
    | Expression.Access.Member
    | Expression.Access.Slice
    | Expression.Access.Index;

  export const isAccess = (
    expression: Node.Base,
  ): expression is Expression.Access =>
    Expression.Access.isBase(expression) &&
    [
      Expression.Access.isMember,
      Expression.Access.isSlice,
      Expression.Access.isIndex,
    ].some((guard) => guard(expression));

  export namespace Access {
    export interface Base extends Node.Base {
      type: "AccessExpression";
      object: Expression;
    }

    export const isBase = (access: unknown): access is Expression.Access.Base =>
      Node.isBase(access) &&
      access.type === "AccessExpression" &&
      "object" in access &&
      isExpression(access.object);

    export interface Member extends Expression.Access.Base {
      kind: "member";
      property: string;
    }

    export function member(
      id: Id,
      object: Expression,
      property: string,
      loc?: SourceLocation,
    ): Expression.Access.Member {
      return {
        id,
        type: "AccessExpression",
        kind: "member",
        object,
        property,
        loc: loc ?? null,
      };
    }

    export const isMember = (
      access: Expression.Access.Base,
    ): access is Expression.Access.Member =>
      "kind" in access && access.kind === "member";

    export interface Slice extends Expression.Access.Base {
      kind: "slice";
      start: Expression;
      end: Expression;
    }

    export function slice(
      id: Id,
      object: Expression,
      start: Expression,
      end: Expression,
      loc?: SourceLocation,
    ): Expression.Access.Slice {
      return {
        id,
        type: "AccessExpression",
        kind: "slice",
        object,
        start,
        end,
        loc: loc ?? null,
      };
    }

    export const isSlice = (
      access: Expression.Access.Base,
    ): access is Expression.Access.Slice =>
      "kind" in access && access.kind === "slice";

    export interface Index extends Expression.Access.Base {
      kind: "index";
      index: Expression;
    }

    export function index(
      id: Id,
      object: Expression,
      index: Expression,
      loc?: SourceLocation,
    ): Expression.Access.Index {
      return {
        id,
        type: "AccessExpression",
        kind: "index",
        object,
        index,
        loc: loc ?? null,
      };
    }

    export const isIndex = (
      access: Expression.Access.Base,
    ): access is Expression.Access.Index =>
      "kind" in access && access.kind === "index";
  }

  export interface Call extends Node.Base {
    type: "CallExpression";
    callee: Expression;
    arguments: Expression[];
  }

  export const isCall = (
    expression: Node.Base,
  ): expression is Expression.Call =>
    expression.type === "CallExpression" &&
    "callee" in expression &&
    typeof expression.callee === "object" &&
    "arguments" in expression &&
    Array.isArray(expression.arguments);

  export function call(
    id: Id,
    callee: Expression,
    args: Expression[],
    loc?: SourceLocation,
  ): Expression.Call {
    return {
      id,
      type: "CallExpression",
      callee,
      arguments: args,
      loc: loc ?? null,
    };
  }

  export interface Cast extends Node.Base {
    type: "CastExpression";
    expression: Expression;
    targetType: Type;
  }

  export const isCast = (
    expression: Node.Base,
  ): expression is Expression.Cast =>
    expression.type === "CastExpression" &&
    "expression" in expression &&
    typeof expression.expression === "object" &&
    "targetType" in expression &&
    typeof expression.targetType === "object";

  export function cast(
    id: Id,
    expression: Expression,
    targetType: Type,
    loc?: SourceLocation,
  ): Expression.Cast {
    return {
      id,
      type: "CastExpression",
      expression,
      targetType,
      loc: loc ?? null,
    };
  }

  export interface Special extends Node.Base {
    type: "SpecialExpression";
    kind:
      | "msg.sender"
      | "msg.value"
      | "msg.data"
      | "block.timestamp"
      | "block.number";
    // Extensible for other special values
  }

  export const isSpecial = (
    expression: Node.Base,
  ): expression is Expression.Special =>
    expression.type === "SpecialExpression" &&
    "kind" in expression &&
    typeof expression.kind === "string";

  export function special(
    id: Id,
    kind: Expression.Special["kind"],
    loc?: SourceLocation,
  ): Expression.Special {
    return { id, type: "SpecialExpression", kind, loc: loc ?? null };
  }
}
