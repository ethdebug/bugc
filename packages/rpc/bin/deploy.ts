#!/usr/bin/env tsx
/* eslint-disable no-console */

/**
 * CLI tool to deploy BUG contracts to an RPC node
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { compile } from "@ethdebug/bugc";
import { formatError } from "@ethdebug/bugc/dist/src/cli";
import { CliBase, BaseCliOptions } from "../src/cli-base.js";

interface DeployOptions extends BaseCliOptions {
  from?: string;
  gas?: string;
  value?: string;
  "save-debug"?: string;
  optimize?: string;
}

class DeployCli extends CliBase<DeployOptions> {
  constructor() {
    super({
      name: "bug-deploy",
      description: "Deploy BUG contracts to an RPC node",
      allowPositionals: true,
      options: {
        from: {
          type: "string",
          description: "Deployer address (uses first account if not specified)",
        },
        gas: {
          type: "string",
          description: "Gas limit (auto-estimates if not specified)",
        },
        value: {
          type: "string",
          default: "0x0",
          description: "ETH to send with deployment",
        },
        "save-debug": {
          type: "string",
          description: "Save debug info to file",
        },
        optimize: {
          type: "string",
          short: "O",
          default: "0",
          description: "Optimization level (0-3)",
        },
      },
      examples: [
        "bug-deploy counter.bug",
        "bug-deploy --from 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 counter.bug",
        "bug-deploy --save-debug counter.debug.json examples/counter.bug",
      ],
    });
  }

  protected shouldShowHelp(): boolean {
    return this.values.help || this.positionals.length === 0;
  }

  protected validateArgs(): void {
    if (this.positionals.length === 0) {
      throw new Error("No source file specified");
    }
  }

  protected async execute(): Promise<void> {
    const filePath = resolve(this.positionals[0]);

    // Read and compile the BUG source
    console.log(`Compiling ${filePath}...`);
    const source = readFileSync(filePath, "utf-8");

    const optimizationLevel = parseInt(this.values.optimize || "0");

    // Always compile to bytecode first
    const bytecodeResult = await compile({
      to: "bytecode",
      source,
      sourcePath: filePath,
      optimizer: { level: optimizationLevel as 0 | 1 | 2 | 3 },
    });

    if (!bytecodeResult.success) {
      console.error("Compilation failed:\n");
      const errors = bytecodeResult.messages.error || [];
      for (const error of errors) {
        console.error(formatError(error, source));
      }
      process.exit(1);
    }

    // Extract bytecode from the new interface structure
    const { runtime, create } = bytecodeResult.value.bytecode;
    const constructorBytecode = create ? Buffer.from(create).toString("hex") : undefined;
    const bytecode = Buffer.from(runtime).toString("hex");

    // Compile to debug if requested
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    let debugInfo: any | undefined;
    if (this.values["save-debug"]) {
      // Debug compilation is not yet available in the new interface
      // TODO: Add debug compilation when available
      console.warn("Debug info generation not yet available");
    }

    if (!constructorBytecode) {
      throw new Error("No constructor bytecode generated");
    }

    console.log(`Constructor bytecode: ${constructorBytecode.length / 2} bytes`);
    console.log(`Runtime bytecode: ${bytecode?.length ? bytecode.length / 2 : 0} bytes`);

    // Get accounts and determine sender
    const accounts = await this.getAccounts();
    const from = this.values.from || accounts[0];
    console.log(`Deploying from: ${from}`);

    // Check balance
    const balance = await this.client.eth_getBalance(from);
    console.log(`Balance: ${this.formatBalance(balance)}`);

    // Prepare transaction
    const tx = {
      from,
      data: "0x" + constructorBytecode,
      value: this.values.value || "0x0",
      gas: this.values.gas,
    };

    // Estimate gas if not provided
    if (!tx.gas) {
      tx.gas = await this.estimateGasWithBuffer(tx);
    }

    // Send transaction
    console.log("Sending transaction...");
    const txHash = await this.client.eth_sendTransaction(tx);
    console.log(`Transaction hash: ${txHash}`);

    // Wait for receipt
    console.log("Waiting for confirmation...");
    const receipt = await this.client.waitForTransactionReceipt(txHash);

    if (!this.client.isTransactionSuccessful(receipt)) {
      console.error("Transaction failed!");
      console.error(`Gas used: ${receipt.gasUsed}`);
      process.exit(1);
    }

    const contractAddress = receipt.contractAddress!;
    console.log(`\n✅ Contract deployed to: ${contractAddress}`);
    console.log(`Gas used: ${receipt.gasUsed}`);
    console.log(`Block number: ${parseInt(receipt.blockNumber, 16)}`);

    // Verify deployment
    const deployedCode = await this.client.eth_getCode(contractAddress);
    if (deployedCode === "0x") {
      console.error("Warning: No code at deployed address!");
    } else {
      console.log(`Deployed code size: ${(deployedCode.length - 2) / 2} bytes`);
    }

    // Save debug info if requested
    if (this.values["save-debug"] && debugInfo) {
      // Add deployment info
      const enhancedDebugInfo = {
        ...debugInfo,
        deployment: {
          address: contractAddress,
          transactionHash: txHash,
          blockNumber: parseInt(receipt.blockNumber, 16),
          deployer: from,
          timestamp: new Date().toISOString(),
        },
      };

      const debugPath = resolve(this.values["save-debug"]);
      writeFileSync(debugPath, JSON.stringify(enhancedDebugInfo, null, 2));
      console.log(`\nDebug info saved to: ${debugPath}`);
    }

    console.log("\nDeployment successful! 🎉");
  }
}

const cli = new DeployCli();
cli.run();
