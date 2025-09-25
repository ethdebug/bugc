import type * as Ir from "#ir";
import type * as Format from "@ethdebug/format";

/**
 * Combine multiple debug contexts into a single context.
 * If multiple contexts have source information, creates a pick context.
 * Filters out empty contexts.
 */
export function combineDebugContexts(
  ...debugs: (Ir.Instruction.Debug | Ir.Block.Debug | undefined)[]
): Ir.Instruction.Debug {
  // Filter out undefined and empty debug objects
  const contexts = debugs
    .filter((d): d is Ir.Instruction.Debug | Ir.Block.Debug => d !== undefined)
    .map((d) => d.context)
    .filter((c): c is Format.Program.Context => c !== undefined);

  if (contexts.length === 0) {
    return {};
  }

  // Deduplicate contexts by checking structural equality
  const uniqueContexts: Format.Program.Context[] = [];
  const contextStrings = new Set<string>();

  for (const context of contexts) {
    // Create a string representation for comparison
    // We need to handle the structure carefully since it might have nested objects
    const contextStr = JSON.stringify(context, (_key, value) => {
      // Sort object keys to ensure consistent stringification
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.keys(value)
          .sort()
          .reduce((sorted, key) => {
            sorted[key] = value[key];
            return sorted;
          }, {} as any);
      }
      return value;
    });

    if (!contextStrings.has(contextStr)) {
      contextStrings.add(contextStr);
      uniqueContexts.push(context);
    }
  }

  if (uniqueContexts.length === 0) {
    return {};
  }

  if (uniqueContexts.length === 1) {
    return { context: uniqueContexts[0] };
  }

  // Multiple unique contexts - create a pick context
  return {
    context: {
      pick: uniqueContexts,
    } as Format.Program.Context,
  };
}

/**
 * Preserve debug context from the original instruction when creating a replacement.
 * Optionally combine with additional debug contexts.
 */
export function preserveDebug(
  original: { debug?: Ir.Instruction.Debug | Ir.Block.Debug },
  ...additional: (Ir.Instruction.Debug | Ir.Block.Debug | undefined)[]
): Ir.Instruction.Debug {
  return combineDebugContexts(original.debug, ...additional);
}

/**
 * Extract contexts from debug objects for transformation tracking
 */
export function extractContexts(
  ...items: ({ debug?: Ir.Instruction.Debug | Ir.Block.Debug } | undefined)[]
): Format.Program.Context[] {
  const contexts: Format.Program.Context[] = [];

  for (const item of items) {
    if (item?.debug?.context) {
      contexts.push(item.debug.context);
    }
  }

  return contexts;
}
