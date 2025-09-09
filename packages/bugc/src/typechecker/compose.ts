import type { Visitor } from "#ast";

/**
 * Composes multiple partial visitors into a complete visitor.
 * Each partial visitor can implement a subset of the visitor methods.
 * The first visitor that implements a method wins.
 */
export function composeVisitors<T, C>(
  ...visitors: Partial<Visitor<T, C>>[]
): Visitor<T, C> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const composed = {} as any; // We'll ensure it's complete below

  // All required visitor methods
  const requiredMethods: (keyof Visitor<T, C>)[] = [
    "program",
    "declaration",
    "block",
    "elementaryType",
    "complexType",
    "referenceType",
    "declarationStatement",
    "assignmentStatement",
    "controlFlowStatement",
    "expressionStatement",
    "identifierExpression",
    "literalExpression",
    "operatorExpression",
    "accessExpression",
    "callExpression",
    "castExpression",
    "specialExpression",
  ];

  // For each required method, find the first visitor that implements it
  for (const method of requiredMethods) {
    let found = false;
    for (const visitor of visitors) {
      if (visitor[method]) {
        composed[method] = visitor[method];
        found = true;
        break;
      }
    }

    if (!found) {
      throw new Error(
        `Missing visitor method: ${String(method)}. ` +
          `No provided visitor implements this method.`,
      );
    }
  }

  return composed as Visitor<T, C>;
}
