#!/usr/bin/env tsx
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execAsync = promisify(exec);

async function generatePackageGraph(): Promise<void> {
  console.log('Generating bugc package dependency graph...');

  try {
    // Generate madge JSON output
    await execAsync(
      'yarn --silent madge packages/bugc --json --exclude "node_modules|../../format|dist|test" > /tmp/madge-output.json'
    );

    // Read the JSON file
    const jsonOutput = await fs.readFile('/tmp/madge-output.json', 'utf-8');
    const dependencies = JSON.parse(jsonOutput);

    // Build our own DOT file from scratch
    const nodes = new Set<string>();
    const edges: Array<[string, string]> = [];
    const nodeToCluster = new Map<string, string>(); // Maps node IDs to their cluster IDs
    const indexNodes = new Set<string>(); // Track which nodes are index files

    // Hierarchical directory structure
    interface DirNode {
      name: string;
      path: string;
      files: Set<string>;
      children: Map<string, DirNode>;
    }

    const rootDirs = new Map<string, DirNode>();

    // First pass: collect all files
    const fileMapping = new Map<string, string>();

    for (const file of Object.keys(dependencies)) {
      // Skip external dependencies
      if (file.includes('node_modules') || file.includes('../format')) continue;

      // Skip test files and test directory
      if (file.includes('.test.ts') || file.includes('.test.tsx') || file.includes('/test/')) continue;

      // Only process bugc package files
      if (!file.startsWith('bugc/')) continue;

      // Process the file path
      const match = file.match(/^bugc\/(.*)/);
      if (!match) continue;

      const filePath = match[1];
      let cleanPath = filePath.replace(/\.(ts|tsx|d\.ts)$/, '');

      // Map .d.ts files to their source equivalents
      if (filePath.includes('.d.ts')) {
        cleanPath = cleanPath.replace(/^dist\//, 'src/');
      }

      const nodeId = cleanPath;
      fileMapping.set(file, nodeId);
      nodes.add(nodeId);

      // Track index files
      if (cleanPath.endsWith('/index')) {
        indexNodes.add(nodeId);
      }

      // Build hierarchical directory structure
      const pathParts = cleanPath.split('/');
      let currentLevel = rootDirs;
      let currentPath = '';

      // Navigate/create the directory hierarchy
      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i];
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        if (!currentLevel.has(part)) {
          currentLevel.set(part, {
            name: part,
            path: currentPath,
            files: new Set<string>(),
            children: new Map<string, DirNode>()
          });
        }

        const dirNode = currentLevel.get(part)!;
        currentLevel = dirNode.children;

        // If this is the parent directory of the file, add the file to it
        if (i === pathParts.length - 2) {
          dirNode.files.add(cleanPath);
        }
      }

      // Handle files directly in root directories (e.g., bin/foo.ts)
      if (pathParts.length === 2) {
        const rootDir = rootDirs.get(pathParts[0]);
        if (rootDir) {
          rootDir.files.add(cleanPath);
        }
      }
    }

    // Second pass: process dependencies
    for (const [file, deps] of Object.entries(dependencies)) {
      if (file.includes('node_modules') || file.includes('../format') || file.includes('/test/')) continue;

      const fromNode = fileMapping.get(file);
      if (!fromNode) continue;

      for (let dep of deps as string[]) {
        if (dep.includes('node_modules') || dep.includes('../format') || dep.includes('/test/')) continue;

        // Handle @ethdebug/bugc imports
        if (dep.startsWith('@ethdebug/bugc/')) {
          dep = dep.replace('@ethdebug/bugc/', 'bugc/src/');
        } else if (dep === '@ethdebug/bugc') {
          dep = 'bugc/src/index';
        }

        const toNode = fileMapping.get(dep);
        if (!toNode) continue;

        // Avoid self-loops
        if (fromNode !== toNode) {
          edges.push([fromNode, toNode]);
        }
      }
    }

    // Read package.json exports
    const packageJsonPath = 'packages/bugc/package.json';
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
    const packageExports = new Map<string, string>(); // export path -> actual file

    if (packageJson.exports) {
      for (const [exportPath, exportConfig] of Object.entries(packageJson.exports)) {
        if (typeof exportConfig === 'object' && exportConfig !== null) {
          // Handle { types: "...", import: "..." } format
          const importPath = (exportConfig as any).import;
          if (importPath) {
            // Convert dist path to src path
            const srcPath = importPath
              .replace(/^\.\/dist\//, 'src/')
              .replace(/\.js$/, '');
            packageExports.set(exportPath, srcPath);
          }
        }
      }
    }

    // Color scheme for different directories
    const colorScheme: Record<string, { fill: string; border: string }> = {
      'exports': { fill: '#ffebee', border: '#d32f2f' }, // Light red - Package exports
      'src': { fill: '#f5f5f5', border: '#9e9e9e' }, // Light gray - Root src
      'src/ast': { fill: '#e3f2fd', border: '#1976d2' }, // Light blue - Language domain
      'src/intermediator': { fill: '#fff3e0', border: '#f57c00' }, // Light amber - Transformation
      'src/ir': { fill: '#e8f5e9', border: '#388e3c' }, // Light green - Intermediate domain
      'src/evm': { fill: '#ffebee', border: '#d32f2f' }, // Light red - Target platform
      'src/parser': { fill: '#e0f2f1', border: '#00796b' }, // Light cyan - Parsing
      'src/typechecker': { fill: '#f3e5f5', border: '#7b1fa2' }, // Light purple - Analysis
      'src/codegen': { fill: '#fff8e1', border: '#fbc02d' }, // Light yellow - Generation
      'src/errors': { fill: '#f5f5f5', border: '#616161' }, // Light gray - Infrastructure
      'src/analysis': { fill: '#fff8f0', border: '#d49855' }, // Light orange - Analysis tools
      'src/debug': { fill: '#f8f0ff', border: '#9b6dd4' }, // Light lavender - Debug info
      'src/optimizer': { fill: '#f0fff8', border: '#55d49b' }, // Light mint - Optimization
      'src/optimizer/passes': { fill: '#e0fff0', border: '#44c88a' }, // Darker mint - Optimization passes
      'bin': { fill: '#fff0f8', border: '#d455a0' }, // Light pink - CLI tools
      'test': { fill: '#fafafa', border: '#888888' }, // Very light gray - Tests
    };

    // Generate DOT file
    let dot = `digraph G {
  rankdir=TB;
  compound=true;
  concentrate=true;
  bgcolor="white";
  ranksep=1.2;
  nodesep=0.4;

  node [shape=box, style="rounded,filled", fillcolor="#ffffff", fontname="Arial", fontsize=10, color="#bbbbbb"];
  edge [color="#666666", fontname="Arial", fontsize=8];

`;

    // Recursive function to generate nested subgraphs
    let clusterIndex = 0;
    const generateSubgraph = (dirNode: DirNode, indent: string = '  '): string => {
      const clusterId = `cluster_${clusterIndex++}`;

      // Get color for this directory
      let colors = colorScheme[dirNode.path] || { fill: '#fafafa', border: '#999999' };

      // Check for parent paths if exact match not found
      if (!colorScheme[dirNode.path]) {
        const pathParts = dirNode.path.split('/');
        for (let i = pathParts.length; i > 0; i--) {
          const parentPath = pathParts.slice(0, i).join('/');
          if (colorScheme[parentPath]) {
            colors = colorScheme[parentPath];
            break;
          }
        }
      }

      let subgraphDot = `${indent}subgraph ${clusterId} {
`;
      subgraphDot += `${indent}  label="${dirNode.name}";
`;
      subgraphDot += `${indent}  style="rounded,filled";
`;
      subgraphDot += `${indent}  fillcolor="${colors.fill}";
`;
      subgraphDot += `${indent}  color="${colors.border}";
`;
      subgraphDot += `${indent}  penwidth=1.5;
`;
      subgraphDot += `${indent}  fontname="Arial";
`;
      subgraphDot += `${indent}  fontsize=12;
`;
      subgraphDot += `${indent}  fontcolor="#555555";
`;
      subgraphDot += `${indent}  margin=10;
`;
      subgraphDot += `${indent}
`;

      // Add files in this directory
      for (const file of Array.from(dirNode.files).sort()) {
        nodeToCluster.set(file, clusterId);

        // Shorten the label by removing the directory path for cleaner display
        let label = file;
        if (file.startsWith(dirNode.path + '/')) {
          label = file.substring(dirNode.path.length + 1);
        }

        // Style index files differently
        if (indexNodes.has(file)) {
          subgraphDot += `${indent}  "${file}" [label="${label}", shape=folder, fillcolor="#e0e0e0", fontweight=bold];\n`;
        } else {
          subgraphDot += `${indent}  "${file}" [label="${label}"];\n`;
        }
      }

      // Recursively add child directories
      for (const childDir of Array.from(dirNode.children.values()).sort((a, b) => a.name.localeCompare(b.name))) {
        subgraphDot += generateSubgraph(childDir, indent + '  ');
      }

      subgraphDot += `${indent}}\n`;

      return subgraphDot;
    }

    // Generate subgraphs for all root directories
    for (const rootDir of Array.from(rootDirs.values()).sort((a, b) => a.name.localeCompare(b.name))) {
      if (rootDir.name === 'src') {
        // Special case: don't create a subgraph for src, just process its children
        for (const childDir of Array.from(rootDir.children.values()).sort((a, b) => a.name.localeCompare(b.name))) {
          dot += generateSubgraph(childDir);
          dot += '\n';
        }
        // Add any files directly in src (not in subdirectories)
        for (const file of Array.from(rootDir.files).sort()) {
          // Style index files differently
          if (indexNodes.has(file)) {
            dot += `  "${file}" [label="${file}", shape=folder, fillcolor="#e0e0e0", fontweight=bold];\n`;
          } else {
            dot += `  "${file}" [label="${file}"];\n`;
          }
        }
        if (rootDir.files.size > 0) {
          dot += '\n';
        }
      } else {
        dot += generateSubgraph(rootDir);
        dot += '\n';
      }
    }

    // Add exports cluster with virtual nodes
    if (packageExports.size > 0) {
      const colors = colorScheme['exports'];
      dot += `  subgraph cluster_exports {
    label="exports";
    style="rounded,filled";
    fillcolor="${colors.fill}";
    color="${colors.border}";
    penwidth=1.5;
    fontname="Arial";
    fontsize=12;
    fontcolor="#555555";
    margin=10;

`;

      // Create virtual nodes for each export
      for (const [exportPath, _targetFile] of Array.from(packageExports.entries()).sort()) {
        const virtualNodeId = `export:${exportPath}`;

        // Add the virtual node with diamond shape to indicate it's not a real file
        dot += `    "${virtualNodeId}" [label="${exportPath}", shape=diamond, fillcolor="#ffcccc"];\n`;
      }

      dot += '  }\n\n';
    }

    // Add edges with special styling
    dot += '  // Dependencies\n';
    for (const [from, to] of edges) {
      const edgeAttributes: string[] = [];

      // Style edges to index files differently
      if (indexNodes.has(to)) {
        edgeAttributes.push('arrowhead=vee', 'arrowsize=1.2');

        // If it's from a different cluster, make it more prominent
        const fromCluster = nodeToCluster.get(from);
        const toCluster = nodeToCluster.get(to);
        if (fromCluster !== toCluster) {
          edgeAttributes.push('penwidth=2');
        }
      }

      const attrs = edgeAttributes.length > 0 ? ` [${edgeAttributes.join(', ')}]` : '';
      dot += `  "${from}" -> "${to}"${attrs};\n`;
    }

    // Add edges from virtual export nodes to their target files
    dot += '\n  // Export mappings\n';
    for (const [exportPath, targetFile] of packageExports) {
      const virtualNodeId = `export:${exportPath}`;
      // Only add edge if target file exists in our graph
      if (nodes.has(targetFile)) {
        dot += `  "${virtualNodeId}" -> "${targetFile}" [color="#cc0000", penwidth=2, arrowhead=vee];\n`;
      }
    }

    dot += '}\n';

    // Write DOT file
    await fs.writeFile('dependency-graph.dot', dot);
    console.log('Generated dependency-graph.dot');

    // Generate SVG
    try {
      await execAsync('dot -Tsvg dependency-graph.dot -o dependency-graph.svg');
      console.log('Generated dependency-graph.svg');
    } catch (error) {
      console.log('Could not generate SVG. Make sure graphviz is installed (brew install graphviz)');
      console.error(error);
    }

  } catch (error) {
    console.error('Error generating graph:', error);
  }
}

// Run the script
generatePackageGraph().catch(console.error);
