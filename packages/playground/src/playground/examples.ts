export interface Example {
  name: string;
  displayName: string;
  code: string;
}

// Import all .bug files from the examples directory
// Vite will inline the file contents at build time
const exampleFiles = import.meta.glob("../../../../examples/*.bug", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Map the actual example files to the Example interface
export const examples: Example[] = [
  {
    name: "minimal",
    displayName: "Minimal",
    code: exampleFiles["../../../../examples/minimal.bug"] || "",
  },
  {
    name: "owner-counter",
    displayName: "Owner Counter",
    code: exampleFiles["../../../../examples/owner-counter.bug"],
  },
  {
    name: "conditionals",
    displayName: "Conditionals",
    code: exampleFiles["../../../../examples/conditionals.bug"],
  },
  {
    name: "arrays-and-loops",
    displayName: "Arrays and Loops",
    code: exampleFiles["../../../../examples/arrays-and-loops.bug"],
  },
  {
    name: "voting-system",
    displayName: "Voting System",
    code: exampleFiles["../../../../examples/voting-system.bug"],
  },
  {
    name: "token-registry",
    displayName: "Token Registry",
    code: exampleFiles["../../../../examples/token-registry.bug"],
  },
  {
    name: "optimizations",
    displayName: "Optimizations Demo",
    code: exampleFiles["../../../../examples/optimizations.bug"],
  },
  {
    name: "simple-functions",
    displayName: "Simple Functions",
    code: exampleFiles["../../../../examples/simple-functions.bug"],
  },
  {
    name: "array-length",
    displayName: "Array Length",
    code: exampleFiles["../../../../examples/array-length.bug"],
  },
  {
    name: "string-length",
    displayName: "String Length",
    code: exampleFiles["../../../../examples/string-length.bug"],
  },
  {
    name: "cse",
    displayName: "CSE Demo",
    code: exampleFiles["../../../../examples/cse.bug"],
  },
];
