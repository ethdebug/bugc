#!/usr/bin/env tsx
/* eslint-disable no-console */

/**
 * CLI tool to call BUG contracts on an RPC node
 */

import { CliBase, BaseCliOptions } from "../src/cli-base";

interface CallOptions extends BaseCliOptions {
  to?: string;
  from?: string;
  data?: string;
  value?: string;
  gas?: string;
  call?: boolean;
}

class CallCli extends CliBase<CallOptions> {
  constructor() {
    super({
      name: "bug-call",
      description: "Call BUG contracts on an RPC node",
      options: {
        to: {
          type: "string",
          required: true,
          description: "Contract address to call",
        },
        from: {
          type: "string",
          description: "Sender address (uses first account if not specified)",
        },
        data: {
          type: "string",
          default: "0x",
          description: "Calldata in hex format",
        },
        value: {
          type: "string",
          default: "0x0",
          description: "ETH to send with call",
        },
        gas: {
          type: "string",
          description: "Gas limit (auto-estimates if not specified)",
        },
        call: {
          type: "boolean",
          default: false,
          description: "Use eth_call instead of sending transaction",
        },
      },
      examples: [
        "bug-call --to 0x5FbDB2315678afecb367f032d93F642f64180aa3 --data 0x12345678",
        "bug-call --to 0x5FbDB2315678afecb367f032d93F642f64180aa3 --call",
        "bug-call --to 0x5FbDB2315678afecb367f032d93F642f64180aa3 --value 0x1",
      ],
    });
  }

  protected shouldShowHelp(): boolean {
    return this.values.help || !this.values.to;
  }

  protected validateArgs(): void {
    if (!this.values.to) {
      throw new Error("Contract address (--to) is required");
    }
  }

  protected async execute(): Promise<void> {
    // Validate contract exists
    await this.ensureContractExists(this.values.to!);

    // Prepare transaction
    const tx = {
      to: this.values.to!,
      data: this.values.data || "0x",
      value: this.values.value || "0x0",
      from: this.values.from,
      gas: this.values.gas,
    };

    // If no from address, get first account
    if (!tx.from) {
      const accounts = await this.getAccounts();
      tx.from = accounts[0];
    }

    console.log(`Contract: ${tx.to}`);
    console.log(`From: ${tx.from}`);
    if (tx.data !== "0x") {
      console.log(`Data: ${tx.data}`);
    }
    if (tx.value !== "0x0") {
      console.log(`Value: ${tx.value} wei`);
    }

    // Handle read-only call
    if (this.values.call) {
      console.log("\nExecuting call (read-only)...");
      const result = await this.client.eth_call(tx);
      console.log(`Result: ${result}`);

      if (result !== "0x") {
        // Try to decode as uint256
        try {
          const value = BigInt(result);
          console.log(`Decoded: ${value}`);
        } catch {
          // Not a simple number
        }
      }
      return;
    }

    // Send transaction
    // Estimate gas if not provided
    if (!tx.gas) {
      tx.gas = await this.estimateGasWithBuffer(tx);
    }

    // Check balance
    const balance = await this.client.eth_getBalance(tx.from);
    console.log(`Balance: ${this.formatBalance(balance)}`);

    // Send transaction
    console.log("\nSending transaction...");
    const txHash = await this.client.eth_sendTransaction(tx);
    console.log(`Transaction hash: ${txHash}`);

    // Wait for receipt
    console.log("Waiting for confirmation...");
    const receipt = await this.client.waitForTransactionReceipt(txHash);

    if (!this.client.isTransactionSuccessful(receipt)) {
      console.error("\n❌ Transaction failed!");
      console.error(`Gas used: ${receipt.gasUsed}`);

      // Try to get revert reason
      try {
        await this.client.eth_call(tx, receipt.blockNumber);
      } catch (error) {
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        if (error instanceof Error && (error as any).data) {
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
          console.error(`Revert reason: ${(error as any).data}`);
        }
      }
      process.exit(1);
    }

    console.log(`\n✅ Transaction successful!`);
    console.log(`Gas used: ${receipt.gasUsed}`);
    console.log(`Block number: ${parseInt(receipt.blockNumber, 16)}`);

    // Show logs if any
    if (receipt.logs.length > 0) {
      console.log(`\nLogs (${receipt.logs.length}):`);
      for (const log of receipt.logs) {
        console.log(`  Address: ${log.address}`);
        console.log(`  Topics: ${log.topics.join(", ")}`);
        if (log.data !== "0x") {
          console.log(`  Data: ${log.data}`);
        }
      }
    }
  }
}

const cli = new CallCli();
cli.run();
