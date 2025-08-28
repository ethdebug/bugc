import { parseArgs, ParseArgsConfig } from "util";
import { createProvider } from "./provider";
import { RpcClient } from "./client";

export interface BaseCliOptions {
  "rpc-url"?: string;
  help?: boolean;
}

// Extended option config that includes our custom properties
export interface ExtendedOptionConfig {
  type?: "string" | "boolean";
  multiple?: boolean;
  short?: string;
  default?: string | boolean | string[] | boolean[];
  description?: string;
  required?: boolean;
}

export interface CliConfig {
  name: string;
  description: string;
  options: Record<string, ExtendedOptionConfig>;
  allowPositionals?: boolean;
  examples?: string[];
}

export abstract class CliBase<T extends BaseCliOptions = BaseCliOptions> {
  protected values: T;
  protected positionals: string[];
  protected client: RpcClient;

  constructor(protected config: CliConfig) {
    // Strip out custom properties before passing to parseArgs
    const parseOptions: ParseArgsConfig["options"] = {};
    for (const [key, value] of Object.entries(config.options)) {
      // Extract only the properties needed for parseArgs
      const { type, multiple, short, default: defaultValue } = value;
      // Only add if type is defined (parseArgs requires it)
      if (type) {
        const option: NonNullable<ParseArgsConfig["options"]>[string] = {
          type,
        };
        if (multiple !== undefined) option.multiple = multiple;
        if (short !== undefined) option.short = short;
        if (defaultValue !== undefined) option.default = defaultValue;
        parseOptions[key] = option;
      }
    }

    const parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: config.allowPositionals ?? false,
      options: {
        "rpc-url": {
          type: "string",
          default: "http://localhost:8545",
        },
        help: {
          type: "boolean",
          short: "h",
        },
        ...parseOptions,
      },
    });

    this.values = parsed.values as T;
    this.positionals = parsed.positionals;

    if (this.shouldShowHelp()) {
      this.showHelp();
      process.exit(0);
    }

    // Initialize RPC client
    const provider = createProvider(
      this.values["rpc-url"] || "http://localhost:8545",
    );
    this.client = new RpcClient(provider);
  }

  protected abstract shouldShowHelp(): boolean;
  protected abstract validateArgs(): void;
  protected abstract execute(): Promise<void>;

  protected showHelp(): void {
    console.log(`${this.config.description}\n`);
    console.log(
      `Usage: ${this.config.name} [options]${this.config.allowPositionals ? " [args]" : ""}`,
    );

    // Group options by required/optional
    const requiredOpts: string[] = [];
    const optionalOpts: string[] = [];

    for (const [name, opt] of Object.entries(this.config.options || {})) {
      if (name === "rpc-url" || name === "help") continue;

      const optConfig = opt as {
        type?: "string" | "boolean";
        multiple?: boolean;
        short?: string;
        default?: unknown;
        description?: string;
        required?: boolean;
      };
      const shortFlag = optConfig.short ? `-${optConfig.short}, ` : "    ";
      const defaultVal =
        optConfig.default !== undefined
          ? ` (default: ${optConfig.default})`
          : "";
      const desc = optConfig.description || "";

      const line = `  ${shortFlag}--${name.padEnd(16)} ${desc}${defaultVal}`;

      if (optConfig.required) {
        requiredOpts.push(line);
      } else {
        optionalOpts.push(line);
      }
    }

    if (requiredOpts.length > 0) {
      console.log("\nRequired:");
      requiredOpts.forEach((opt) => console.log(opt));
    }

    console.log("\nOptions:");
    console.log(`  -h, --help             Show this help message`);
    console.log(
      `      --rpc-url <url>    RPC endpoint (default: http://localhost:8545)`,
    );
    optionalOpts.forEach((opt) => console.log(opt));

    if (this.config.examples && this.config.examples.length > 0) {
      console.log("\nExamples:");
      this.config.examples.forEach((example) => console.log(`  ${example}`));
    }
  }

  async run(): Promise<void> {
    try {
      this.validateArgs();
      await this.execute();
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      if (error instanceof Error && "data" in error) {
        console.error("Error data:", (error as { data: unknown }).data);
      }
      process.exit(1);
    }
  }

  protected async getAccounts(): Promise<string[]> {
    const accounts = await this.client.eth_accounts();
    if (accounts.length === 0) {
      throw new Error("No accounts available");
    }
    return accounts;
  }

  protected async ensureContractExists(address: string): Promise<void> {
    const code = await this.client.eth_getCode(address);
    if (code === "0x") {
      throw new Error(`No contract at address ${address}`);
    }
  }

  protected formatBalance(wei: string | bigint): string {
    return `${BigInt(wei) / BigInt(10 ** 18)} ETH`;
  }

  protected async estimateGasWithBuffer(tx: {
    from?: string;
    to?: string;
    gas?: string;
    value?: string;
    data?: string;
  }): Promise<string> {
    console.log("Estimating gas...");
    const gasEstimate = await this.client.eth_estimateGas(tx);
    const gasWithBuffer = (BigInt(gasEstimate) * 110n) / 100n;
    const gasHex = this.client.decimalToHex(gasWithBuffer);
    console.log(`Gas estimate: ${gasEstimate} (using ${gasHex} with buffer)`);
    return gasHex;
  }
}
