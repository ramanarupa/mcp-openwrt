import { Client } from "ssh2";

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

  constructor(config: OpenWRTConfig) {
    this.config = config;
    this.client = new Client();
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.client
        .on("ready", () => {
          this.connected = true;
          resolve();
        })
        .on("error", (err) => {
          reject(err);
        })
        .connect({
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          password: this.config.password,
          privateKey: this.config.privateKey,
        });
    });
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      this.client.end();
      this.connected = false;
    }
  }

  async executeCommand(command: string): Promise<string> {
    if (!this.connected) {
      throw new Error("Not connected to OpenWRT device");
    }

    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = "";
        let stderr = "";

        stream
          .on("close", (code: number) => {
            if (code !== 0) {
              reject(new Error(`Command failed with code ${code}: ${stderr}`));
            } else {
              resolve(stdout);
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
    const command = `ubus call ${path} ${method} '${paramsJson}'`;

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
    const command = `uci set ${path}='${value}'`;
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
    const command = `cat ${path}`;
    return await this.executeCommand(command);
  }

  /**
   * Write content to a file on the OpenWRT device
   * @param path - file path
   * @param content - content to write
   */
  async writeFile(path: string, content: string): Promise<void> {
    // Escape single quotes in content
    content.replace(/'/g, "'\\''");
    // Use cat with heredoc for reliable multi-line content
    const command = `cat > ${path} << 'EOFMCP'\n${content}\nEOFMCP`;
    await this.executeCommand(command);
  }
}
