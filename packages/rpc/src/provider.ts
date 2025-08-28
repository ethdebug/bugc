/**
 * Simple EIP-1193 provider implementation for HTTP JSON-RPC
 * No external dependencies - uses native Node.js fetch
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown[];
  id: number | string;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: JsonRpcError;
  id: number | string;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export class HttpProvider implements EIP1193Provider {
  private url: string;
  private nextId = 1;

  constructor(url: string = "http://localhost:8545") {
    this.url = url;
  }

  async request({
    method,
    params = [],
  }: {
    method: string;
    params?: unknown[];
  }): Promise<unknown> {
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      params,
      id: this.nextId++,
    };

    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(
        `HTTP error! status: ${response.status} ${response.statusText}`,
      );
    }

    const json = (await response.json()) as JsonRpcResponse;

    if (json.error) {
      throw new RpcError(json.error);
    }

    return json.result;
  }
}

export class RpcError extends Error {
  code: number;
  data?: unknown;

  constructor(error: JsonRpcError) {
    super(error.message);
    this.name = "RpcError";
    this.code = error.code;
    this.data = error.data;
  }
}

/**
 * Create a provider instance
 */
export function createProvider(url?: string): EIP1193Provider {
  return new HttpProvider(url);
}
