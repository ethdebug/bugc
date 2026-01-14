export interface Example {
  name: string;
  displayName: string;
  category: "basic" | "intermediate" | "advanced" | "optimizations";
  code: string;
}

// Import all .bug files from the examples directory (including subdirectories)
// Vite will inline the file contents at build time
const exampleFiles = import.meta.glob("../../../../examples/**/*.bug", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Map the actual example files to the Example interface
// Organized by category, showing only working examples
export const examples: Example[] = [
  // Basic examples
  {
    name: "minimal",
    displayName: "Minimal",
    category: "basic",
    code: exampleFiles["../../../../examples/basic/minimal.bug"] || "",
  },
  {
    name: "conditionals",
    displayName: "Conditionals",
    category: "basic",
    code: exampleFiles["../../../../examples/basic/conditionals.bug"],
  },
  {
    name: "functions",
    displayName: "Functions",
    category: "basic",
    code: exampleFiles["../../../../examples/basic/functions.bug"],
  },
  {
    name: "array-length",
    displayName: "Array Length",
    category: "basic",
    code: exampleFiles["../../../../examples/basic/array-length.bug"],
  },

  // Intermediate examples
  {
    name: "owner-counter",
    displayName: "Owner Counter",
    category: "intermediate",
    code: exampleFiles["../../../../examples/intermediate/owner-counter.bug"],
  },
  {
    name: "arrays",
    displayName: "Arrays and Loops",
    category: "intermediate",
    code: exampleFiles["../../../../examples/intermediate/arrays.bug"],
  },
  {
    name: "mappings",
    displayName: "Mappings",
    category: "intermediate",
    code: exampleFiles["../../../../examples/intermediate/mappings.bug"],
  },
  {
    name: "scopes",
    displayName: "Variable Scopes",
    category: "intermediate",
    code: exampleFiles["../../../../examples/intermediate/scopes.bug"],
  },
  {
    name: "slices",
    displayName: "Byte Slices",
    category: "intermediate",
    code: exampleFiles["../../../../examples/intermediate/slices.bug"],
  },
  {
    name: "calldata",
    displayName: "Calldata Access",
    category: "intermediate",
    code: exampleFiles["../../../../examples/intermediate/calldata.bug"],
  },

  // Advanced examples
  {
    name: "nested-mappings",
    displayName: "Nested Mappings",
    category: "advanced",
    code: exampleFiles["../../../../examples/advanced/nested-mappings.bug"],
  },
  {
    name: "nested-arrays",
    displayName: "Nested Arrays",
    category: "advanced",
    code: exampleFiles["../../../../examples/advanced/nested-arrays.bug"],
  },
  {
    name: "nested-structs",
    displayName: "Nested Structs",
    category: "advanced",
    code: exampleFiles["../../../../examples/advanced/nested-structs.bug"],
  },

  // Optimization demos
  {
    name: "cse",
    displayName: "CSE Demo",
    category: "optimizations",
    code: exampleFiles["../../../../examples/optimizations/cse.bug"],
  },
  {
    name: "constant-folding",
    displayName: "Constant Folding",
    category: "optimizations",
    code: exampleFiles["../../../../examples/optimizations/constant-folding.bug"],
  },
];
