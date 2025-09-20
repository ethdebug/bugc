const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Create a simple test file
const testSource = `module SimplePhiTest {
  storage {
    [0] x: uint256
  }

  @main
  function main() {
    let result: uint256;

    if (x > 5) {
      result = 20;
    } else {
      result = 30;
    }

    x = result;
  }
}`;

// Write to file
fs.writeFileSync('test-phi.bug', testSource);

try {
  // Compile to IR
  const output = execSync('yarn bugc -s ir -O 0 test-phi.bug', { encoding: 'utf-8' });
  console.log("Generated IR:");
  console.log(output);

  // Also get JSON format to inspect phi nodes
  const jsonOutput = execSync('yarn bugc -s ir -O 0 test-phi.bug --json', { encoding: 'utf-8' });
  const ir = JSON.parse(jsonOutput);

  console.log("\n=== Checking for phi nodes ===");
  let foundPhi = false;
  for (const [blockId, block] of Object.entries(ir.main.blocks)) {
    if (block.phis && block.phis.length > 0) {
      foundPhi = true;
      console.log(`Block ${blockId} has ${block.phis.length} phi nodes:`);
      block.phis.forEach(phi => {
        console.log(`  ${phi.dest} = phi`, JSON.stringify(phi.sources));
      });
    }
  }

  if (!foundPhi) {
    console.log("NO PHI NODES FOUND!");
  }

} finally {
  // Clean up
  fs.unlinkSync('test-phi.bug');
}