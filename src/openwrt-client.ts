import { Client, ClientChannel } from "ssh2";
import { shellQuote, uniqueHeredocDelimiter } from "./utils.js";

const DEFAULT_COMMAND_TIMEOUT = 30_000; // 30 seconds

export interface OpenWRTConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

export class OpenWRTClient {
  private client: Client;
  private config: OpenWRTConfig;
  private connected: boolean = false;
  private connectPromise: Promise<void> | null = null;

  constructor(config: OpenWRTConfig) {
    this.config = config;
    this.client = new Client();
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this._doConnect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async _doConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Create a fresh client for each connection attempt
      this.client = new Client();

      this.client
        .on("ready", () => {
          this.connected = true;
          resolve();
        })
        .on("error", (err) => {
          this.connected = false;
          reject(err);
        })
        .on("close", () => {
          this.connected = false;
        })
        .on("end", () => {
          this.connected = false;
        })
        .connect({
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          password: this.config.password,
          privateKey: this.config.privateKey,
          keepaliveInterval: 15_000,
          keepaliveCountMax: 3,
          readyTimeout: 10_000,
        });
    });
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      console.error("SSH connection lost, reconnecting...");
      await this.connect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      this.client.end();
      this.connected = false;
    }
  }

  async executeCommand(command: string, timeout: number = DEFAULT_COMMAND_TIMEOUT): Promise<string> {
    await this.ensureConnected();

    return new Promise((resolve, reject) => {
      let settled = false;
      let activeStream: ClientChannel | null = null;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          if (activeStream) {
            activeStream.close();
          }
          reject(new Error(`Command timed out after ${timeout}ms: ${command.slice(0, 100)}`));
        }
      }, timeout);

      this.client.exec(command, (err, stream) => {
        if (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            // Connection may have dropped — mark as disconnected
            if (err.message?.includes("Not connected") || err.message?.includes("Channel open")) {
              this.connected = false;
            }
            reject(err);
          }
          return;
        }

        activeStream = stream;
        let stdout = "";
        let stderr = "";

        stream
          .on("close", (code: number) => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              if (code !== 0) {
                reject(new Error(`Command failed with code ${code}: ${stderr}`));
              } else {
                resolve(stdout);
              }
            }
          })
          .on("data", (data: Buffer) => {
            stdout += data.toString();
          })
          .stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
          });
      });
    });
  }

  /**
   * Execute a ubus call
   * @param path - ubus path (e.g., "network.interface")
   * @param method - method to call (e.g., "dump", "status")
   * @param params - parameters as object
   */
  async ubusCall(path: string, method: string, params?: Record<string, any>): Promise<any> {
    const paramsJson = params ? JSON.stringify(params) : "{}";
    const command = `ubus call ${path} ${method} ${shellQuote(paramsJson)}`;

    const output = await this.executeCommand(command);

    try {
      return JSON.parse(output);
    } catch (error) {
      throw new Error(`Failed to parse ubus response: ${output}`);
    }
  }

  /**
   * Get UCI configuration value
   * @param config - config name (e.g., "network", "dhcp")
   * @param section - section name (e.g., "lan", "wan")
   * @param option - option name (optional)
   */
  async uciGet(config: string, section: string, option?: string): Promise<string> {
    const path = option
      ? `${config}.${section}.${option}`
      : `${config}.${section}`;

    const command = `uci get ${path}`;
    return (await this.executeCommand(command)).trim();
  }

  /**
   * Set UCI configuration value
   * @param config - config name
   * @param section - section name
   * @param option - option name
   * @param value - value to set
   */
  async uciSet(config: string, section: string, option: string, value: string): Promise<void> {
    const path = `${config}.${section}.${option}`;
    const escapedValue = value.replace(/'/g, "'\\''");
    const command = `uci set ${path}='${escapedValue}'`;
    await this.executeCommand(command);
  }

  /**
   * Commit UCI changes
   * @param config - config name (optional, commits all if not specified)
   */
  async uciCommit(config?: string): Promise<void> {
    const command = config ? `uci commit ${config}` : "uci commit";
    await this.executeCommand(command);
  }

  /**
   * Reload network configuration
   */
  async reloadNetwork(): Promise<void> {
    await this.executeCommand("/etc/init.d/network reload");
  }

  /**
   * Reload dnsmasq service
   */
  async reloadDnsmasq(): Promise<void> {
    await this.executeCommand("/etc/init.d/dnsmasq reload");
  }

  /**
   * Get all UCI configuration sections of a specific type
   */
  async uciShow(config: string): Promise<string> {
    const command = `uci show ${config}`;
    return await this.executeCommand(command);
  }

  /**
   * Add a new UCI section
   * @param config - config name (e.g., "network")
   * @param section - section name
   * @param type - section type (e.g., "route", "interface")
   */
  async uciAddSection(config: string, section: string, type: string): Promise<void> {
    const command = `uci set ${config}.${section}=${type}`;
    await this.executeCommand(command);
  }

  /**
   * Read a file from the OpenWRT device
   * @param path - file path (e.g., "/etc/config/network")
   */
  async readFile(path: string): Promise<string> {
    const command = `cat ${shellQuote(path)}`;
    return await this.executeCommand(command);
  }

  /**
   * Write content to a file on the OpenWRT device
   * @param path - file path
   * @param content - content to write
   */
  async writeFile(path: string, content: string): Promise<void> {
    const delimiter = uniqueHeredocDelimiter(content);
    const command = `cat > ${shellQuote(path)} << '${delimiter}'\n${content}\n${delimiter}`;
    await this.executeCommand(command);
  }
}
