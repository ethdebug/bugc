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

export type Node =
  | Program
  | Declaration
  | Block
  | Type
  | Statement
  | Expression;

export namespace Node {
  export interface Base {
    type: string;
    loc: SourceLocation | null;
  }

  export const isBase = (node: unknown): node is Node.Base =>
    typeof node === "object" &&
    !!node &&
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
  create: Block; // Constructor code block (may be empty)
  body: Block; // Runtime code block (may be empty)
}

export function program(
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
}

// Unified Declaration pattern
// Covers: struct declarations, field declarations, storage declarations, and variable declarations

// export function declaration(
//   kind: Declaration["kind"],
//   name: string,
//   declaredType?: Type,
//   initializer?: Expression,
//   metadata?: Declaration.Metadata,
//   loc?: SourceLocation,
// ): Declaration {
//   return {
//     type: "Declaration",
//     kind,
//     name,
//     declaredType,
//     initializer,
//     metadata,
//     loc: loc ?? null,
//   };
// }

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
    name: string,
    fields: Declaration.Field[],
    loc?: SourceLocation,
  ): Declaration.Struct {
    return {
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
    name: string,
    declaredType?: Type,
    initializer?: Expression,
    loc?: SourceLocation,
  ): Declaration.Field {
    return {
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
    name: string,
    declaredType: Type,
    slot: number,
    loc?: SourceLocation,
  ): Declaration.Storage {
    return {
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
    name: string,
    declaredType?: Type,
    initializer?: Expression,
    loc?: SourceLocation,
  ): Declaration.Variable {
    return {
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
    name: string,
    parameters: FunctionParameter[],
    returnType: Type | undefined,
    body: Block,
    loc?: SourceLocation,
  ): Declaration.Function {
    return {
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
  kind: Block["kind"],
  items: (Statement | Declaration)[],
  loc?: SourceLocation,
): Block {
  return { type: "Block", kind, items, loc: loc ?? null };
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
    kind: Type.Elementary.Kind,
    bits?: number,
    loc?: SourceLocation,
  ): Type.Elementary {
    return { type: "ElementaryType", kind, bits, loc: loc ?? null };
  }

  export function complex(
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
    return { type: "ComplexType", kind, ...options, loc: loc ?? null };
  }

  export function reference(
    name: string,
    loc?: SourceLocation,
  ): Type.Reference {
    return { type: "ReferenceType", name, loc: loc ?? null };
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

  export function uint(bits: number = 256): Type.Elementary {
    return Type.elementary("uint", bits);
  }
  export function int(bits: number = 256): Type.Elementary {
    return Type.elementary("int", bits);
  }
  export function bool(): Type.Elementary {
    return Type.elementary("bool");
  }
  export function address(): Type.Elementary {
    return Type.elementary("address");
  }
  export function bytes(bits?: number): Type.Elementary {
    return Type.elementary("bytes", bits);
  }
  export function string(): Type.Elementary {
    return Type.elementary("string");
  }
  export function fixed(bits: number = 128): Type.Elementary {
    return Type.elementary("fixed", bits);
  }
  export function ufixed(bits: number = 128): Type.Elementary {
    return Type.elementary("ufixed", bits);
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
    declaration: Declaration,
    loc?: SourceLocation,
  ): Statement.Declare {
    return { type: "DeclarationStatement", declaration, loc: loc ?? null };
  }

  export interface Assign extends Node.Base {
    type: "AssignmentStatement";
    target: Expression; // Must be assignable (validated during semantic analysis)
    value: Expression;
    operator?: string; // For compound assignments like += (future)
  }

  export function assign(
    target: Expression,
    value: Expression,
    operator?: string,
    loc?: SourceLocation,
  ): Statement.Assign {
    return {
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
    kind: Statement.ControlFlow["kind"],
    options: Partial<Statement.ControlFlow>,
    loc?: SourceLocation,
  ): Statement.ControlFlow {
    return { type: "ControlFlowStatement", kind, ...options, loc: loc ?? null };
  }

  export interface Express extends Node.Base {
    type: "ExpressionStatement";
    expression: Expression;
  }

  export function express(
    expression: Expression,
    loc?: SourceLocation,
  ): Statement.Express {
    return { type: "ExpressionStatement", expression, loc: loc ?? null };
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

export function isExpression(node: Node): node is Expression {
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

  export function identifier(
    name: string,
    loc?: SourceLocation,
  ): Expression.Identifier {
    return { type: "IdentifierExpression", name, loc: loc ?? null };
  }

  export interface Literal extends Node.Base {
    type: "LiteralExpression";
    kind: "number" | "string" | "boolean" | "address" | "hex";
    value: string; // Always store as string for precision
    unit?: string; // For wei/ether/finney on numbers
  }

  export function literal(
    kind: Expression.Literal["kind"],
    value: string,
    unit?: string,
    loc?: SourceLocation,
  ): Expression.Literal {
    return { type: "LiteralExpression", kind, value, unit, loc: loc ?? null };
  }

  export interface Operator extends Node.Base {
    type: "OperatorExpression";
    operator: string;
    operands: Expression[];
    // Arity is implicit from operands.length
  }

  export function operator(
    operator: string,
    operands: Expression[],
    loc?: SourceLocation,
  ): Expression.Operator {
    return { type: "OperatorExpression", operator, operands, loc: loc ?? null };
  }

  export interface Access extends Node.Base {
    type: "AccessExpression";
    kind: "member" | "index" | "slice";
    object: Expression;
    property: Expression | string; // string for member access, expression for index
    end?: Expression; // For slice access, the end index
  }

  export function access(
    kind: Expression.Access["kind"],
    object: Expression,
    property: Expression | string,
    end?: Expression,
    loc?: SourceLocation,
  ): Expression.Access {
    const node: Expression.Access = {
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
  }

  export interface Call extends Node.Base {
    type: "CallExpression";
    callee: Expression;
    arguments: Expression[];
  }

  export function call(
    callee: Expression,
    args: Expression[],
    loc?: SourceLocation,
  ): Expression.Call {
    return {
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

  export function cast(
    expression: Expression,
    targetType: Type,
    loc?: SourceLocation,
  ): Expression.Cast {
    return {
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

  export function special(
    kind: Expression.Special["kind"],
    loc?: SourceLocation,
  ): Expression.Special {
    return { type: "SpecialExpression", kind, loc: loc ?? null };
  }
}
