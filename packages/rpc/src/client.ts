/**
 * RPC client helper with typed methods for common Ethereum RPC calls
 * All methods manually construct the JSON-RPC requests
 */

import { EIP1193Provider } from "./provider";

export interface TransactionRequest {
  from?: string;
  to?: string;
  gas?: string;
  gasPrice?: string;
  value?: string;
  data?: string;
  nonce?: string;
}

export interface TransactionReceipt {
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  blockNumber: string;
  from: string;
  to: string | null;
  contractAddress: string | null;
  cumulativeGasUsed: string;
  gasUsed: string;
  logs: Log[];
  status: string;
}

export interface Log {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  logIndex: string;
  removed: boolean;
}

export interface Block {
  number: string;
  hash: string;
  parentHash: string;
  timestamp: string;
  gasLimit: string;
  gasUsed: string;
  miner: string;
  transactions: string[] | TransactionRequest[];
}

export class RpcClient {
  constructor(private provider: EIP1193Provider) {}

  /**
   * Get list of accounts
   */
  async eth_accounts(): Promise<string[]> {
    return (await this.provider.request({
      method: "eth_accounts",
      params: [],
    })) as string[];
  }

  /**
   * Get current chain ID
   */
  async eth_chainId(): Promise<string> {
    return (await this.provider.request({
      method: "eth_chainId",
      params: [],
    })) as string;
  }

  /**
   * Get current gas price
   */
  async eth_gasPrice(): Promise<string> {
    return (await this.provider.request({
      method: "eth_gasPrice",
      params: [],
    })) as string;
  }

  /**
   * Get current block number
   */
  async eth_blockNumber(): Promise<string> {
    return (await this.provider.request({
      method: "eth_blockNumber",
      params: [],
    })) as string;
  }

  /**
   * Get balance of an address
   */
  async eth_getBalance(
    address: string,
    blockNumber: string | "latest" = "latest",
  ): Promise<string> {
    return (await this.provider.request({
      method: "eth_getBalance",
      params: [address, blockNumber],
    })) as string;
  }

  /**
   * Get code at address
   */
  async eth_getCode(
    address: string,
    blockNumber: string | "latest" = "latest",
  ): Promise<string> {
    return (await this.provider.request({
      method: "eth_getCode",
      params: [address, blockNumber],
    })) as string;
  }

  /**
   * Get storage at specific slot
   */
  async eth_getStorageAt(
    address: string,
    slot: string,
    blockNumber: string | "latest" = "latest",
  ): Promise<string> {
    return (await this.provider.request({
      method: "eth_getStorageAt",
      params: [address, slot, blockNumber],
    })) as string;
  }

  /**
   * Send a transaction
   */
  async eth_sendTransaction(tx: TransactionRequest): Promise<string> {
    return (await this.provider.request({
      method: "eth_sendTransaction",
      params: [tx],
    })) as string;
  }

  /**
   * Call a contract (read-only)
   */
  async eth_call(
    tx: TransactionRequest,
    blockNumber: string | "latest" = "latest",
  ): Promise<string> {
    return (await this.provider.request({
      method: "eth_call",
      params: [tx, blockNumber],
    })) as string;
  }

  /**
   * Estimate gas for a transaction
   */
  async eth_estimateGas(tx: TransactionRequest): Promise<string> {
    return (await this.provider.request({
      method: "eth_estimateGas",
      params: [tx],
    })) as string;
  }

  /**
   * Get transaction receipt
   */
  async eth_getTransactionReceipt(
    txHash: string,
  ): Promise<TransactionReceipt | null> {
    return (await this.provider.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    })) as TransactionReceipt | null;
  }

  /**
   * Get transaction by hash
   */
  async eth_getTransactionByHash(
    txHash: string,
  ): Promise<TransactionRequest | null> {
    return (await this.provider.request({
      method: "eth_getTransactionByHash",
      params: [txHash],
    })) as TransactionRequest | null;
  }

  /**
   * Get block by number
   */
  async eth_getBlockByNumber(
    blockNumber: string | "latest",
    includeTransactions: boolean = false,
  ): Promise<Block | null> {
    return (await this.provider.request({
      method: "eth_getBlockByNumber",
      params: [blockNumber, includeTransactions],
    })) as Block | null;
  }

  /**
   * Wait for transaction receipt with timeout
   */
  async waitForTransactionReceipt(
    txHash: string,
    timeoutMs: number = 60000,
    intervalMs: number = 1000,
  ): Promise<TransactionReceipt> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const receipt = await this.eth_getTransactionReceipt(txHash);
      if (receipt) {
        return receipt;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Transaction ${txHash} timed out after ${timeoutMs}ms`);
  }

  /**
   * Helper to check if a transaction succeeded
   */
  isTransactionSuccessful(receipt: TransactionReceipt): boolean {
    // Status is "0x1" for success, "0x0" for failure
    return receipt.status === "0x1";
  }

  /**
   * Helper to convert hex to decimal
   */
  hexToDecimal(hex: string): bigint {
    return BigInt(hex);
  }

  /**
   * Helper to convert decimal to hex
   */
  decimalToHex(decimal: bigint | number): string {
    return "0x" + decimal.toString(16);
  }

  /**
   * Helper to pad hex to 32 bytes
   */
  padHex(hex: string, bytes: number = 32): string {
    const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
    return "0x" + cleanHex.padStart(bytes * 2, "0");
  }
}
