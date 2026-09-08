import { Client, ClientChannel } from "ssh2";
import { StringDecoder } from "node:string_decoder";
import { shellQuote, validateName, validateUciSectionRef } from "./utils.js";

const DEFAULT_COMMAND_TIMEOUT = 30_000; // 30 seconds
const DEFAULT_READY_TIMEOUT = 30_000; // SSH handshake timeout (was 10s — too short over slow/laggy links)
/** Max bytes of stdout embedded into a "command failed" error message. */
const ERROR_STDOUT_LIMIT = 4_000;

export interface OpenWRTConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  /** SSH handshake (ready) timeout in ms. Default 30s. Raise for slow uplinks. */
  readyTimeout?: number;
}

export interface ExecuteOptions {
  /** Command timeout in ms (default 30s). */
  timeout?: number;
  /** If set, this string is streamed to the command's stdin and the channel is closed (EOF). */
  stdin?: string;
}

/** Result of a command that ran to completion (any exit code). */
export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Result of a size-capped file read. */
export interface LimitedFileContent {
  content: string;
  /** Actual size of the file on disk, in bytes. */
  size: number;
  /** True when `content` holds fewer bytes than the file. */
  truncated: boolean;
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
          readyTimeout: this.config.readyTimeout ?? DEFAULT_READY_TIMEOUT,
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

  /**
   * Run a command and return its exit code plus full stdout/stderr, without
   * treating a non-zero exit as an error. Rejects only when the command could
   * not be run to completion (timeout, dropped channel, exec failure).
   *
   * Output is decoded with StringDecoder so multi-byte UTF-8 characters that
   * straddle an SSH packet boundary are not mangled into U+FFFD.
   */
  async executeCommandRaw(command: string, options: ExecuteOptions = {}): Promise<CommandResult> {
    const { timeout = DEFAULT_COMMAND_TIMEOUT, stdin } = options;
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
          reject(
            new Error(
              `Command timed out after ${timeout}ms (the remote process may still be running): ${command.slice(0, 100)}`
            )
          );
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
        const stdoutDecoder = new StringDecoder("utf8");
        const stderrDecoder = new StringDecoder("utf8");
        let stdout = "";
        let stderr = "";

        stream
          .on("close", (code: number | null) => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              stdout += stdoutDecoder.end();
              stderr += stderrDecoder.end();
              if (code === null || code === undefined) {
                // Channel closed without an exit status — usually a dropped connection
                this.connected = false;
                reject(
                  new Error(
                    `Command channel closed without exit code (connection may have dropped): ${command.slice(0, 100)}`
                  )
                );
              } else {
                resolve({ code, stdout, stderr });
              }
            }
          })
          .on("data", (data: Buffer) => {
            stdout += stdoutDecoder.write(data);
          })
          .stderr.on("data", (data: Buffer) => {
            stderr += stderrDecoder.write(data);
          });

        // Stream stdin content and signal EOF so commands like `cat > file` terminate
        if (stdin !== undefined) {
          stream.end(stdin);
        }
      });
    });
  }

  /**
   * Run a command and return stdout. A non-zero exit code is an error whose
   * message carries both stderr and (truncated) stdout, so callers never lose
   * the output of a partially successful script.
   */
  async executeCommand(command: string, options: ExecuteOptions = {}): Promise<string> {
    const result = await this.executeCommandRaw(command, options);
    if (result.code !== 0) {
      throw new Error(formatCommandFailure(result));
    }
    return result.stdout;
  }

  /**
   * Execute a ubus call
   * @param path - ubus path (e.g., "network.interface")
   * @param method - method to call (e.g., "dump", "status")
   * @param params - parameters as object
   */
  async ubusCall(path: string, method: string, params?: Record<string, any>): Promise<any> {
    // Validate path and method to prevent shell injection (e.g. "network.interface" / "dump")
    for (const part of path.split(".")) {
      validateName(part, "ubus path component");
    }
    validateName(method, "ubus method");

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
    validateName(config, "UCI config name");
    validateUciSectionRef(section, "UCI section");
    if (option !== undefined) validateName(option, "UCI option name");
    const path = option
      ? `${config}.${section}.${option}`
      : `${config}.${section}`;

    const command = `uci get ${path}`;
    return (await this.executeCommand(command)).trim();
  }

  /**
   * Return the type of a UCI section, or null when it does not exist.
   */
  async uciSectionType(config: string, section: string): Promise<string | null> {
    validateName(config, "UCI config name");
    validateUciSectionRef(section, "UCI section");
    const result = await this.executeCommandRaw(`uci -q get ${config}.${section}`);
    return result.code === 0 ? result.stdout.trim() : null;
  }

  /**
   * Set UCI configuration value
   * @param config - config name
   * @param section - section name
   * @param option - option name
   * @param value - value to set
   */
  async uciSet(config: string, section: string, option: string, value: string): Promise<void> {
    validateName(config, "UCI config name");
    validateUciSectionRef(section, "UCI section");
    validateName(option, "UCI option name");
    const path = `${config}.${section}.${option}`;
    const command = `uci set ${path}=${shellQuote(value)}`;
    await this.executeCommand(command);
  }

  /**
   * Set a UCI option whose value must never appear on a command line
   * (WireGuard private/preshared keys show up in `ps` otherwise). The
   * assignment is fed to `uci batch` via stdin instead.
   *
   * `uci batch` does not stop on a failing line and may exit 0 regardless,
   * so any stderr output is treated as failure.
   */
  async uciSetSecret(config: string, section: string, option: string, value: string): Promise<void> {
    validateName(config, "UCI config name");
    validateUciSectionRef(section, "UCI section");
    validateName(option, "UCI option name");
    // A newline would inject a second batch command; quotes/backslashes would
    // be re-interpreted by uci's tokenizer. Secrets we handle (WG keys) are
    // base64 and never contain these.
    if (value.length === 0 || /[\s'"\\]/.test(value)) {
      throw new Error(`Invalid value for ${config}.${section}.${option}: must be non-empty without whitespace, quotes or backslashes`);
    }
    const result = await this.executeCommandRaw("uci batch", {
      stdin: `set ${config}.${section}.${option}=${value}\n`,
    });
    if (result.code !== 0 || result.stderr.trim().length > 0) {
      throw new Error(`uci batch failed for ${config}.${section}.${option}: ${result.stderr.trim() || `exit code ${result.code}`}`);
    }
  }

  /**
   * Commit UCI changes
   * @param config - config name (optional, commits all if not specified)
   */
  async uciCommit(config?: string): Promise<void> {
    if (config !== undefined) validateName(config, "UCI config name");
    const command = config ? `uci commit ${config}` : "uci commit";
    await this.executeCommand(command);
  }

  /**
   * Revert uncommitted UCI changes
   * @param config - config name (optional, reverts all if not specified)
   */
  async uciRevert(config?: string): Promise<void> {
    if (config !== undefined) validateName(config, "UCI config name");
    const command = config ? `uci revert ${config}` : "uci revert";
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
    validateName(config, "UCI config name");
    const command = `uci show ${config}`;
    return await this.executeCommand(command);
  }

  /**
   * Add a new named UCI section.
   *
   * `uci set config.section=type` silently re-types an existing section, so
   * this checks first: an existing section is an error unless
   * `allowExisting` is set and the type matches (idempotent "ensure").
   *
   * @param config - config name (e.g., "network")
   * @param section - section name
   * @param type - section type (e.g., "route", "interface")
   */
  async uciAddSection(
    config: string,
    section: string,
    type: string,
    options: { allowExisting?: boolean } = {}
  ): Promise<void> {
    validateName(config, "UCI config name");
    validateUciSectionRef(section, "UCI section");
    validateName(type, "UCI section type");

    const existing = await this.uciSectionType(config, section);
    if (existing !== null) {
      if (options.allowExisting && existing === type) {
        return;
      }
      throw new Error(
        `UCI section ${config}.${section} already exists (type '${existing}'); refusing to overwrite it`
      );
    }

    const command = `uci set ${config}.${section}=${type}`;
    await this.executeCommand(command);
  }

  /**
   * Add an anonymous UCI section (`uci add config type`) and return the
   * generated section id (e.g. "cfg0a3b5c"). Use this when the caller has no
   * natural section name — e.g. DHCP hosts whose hostnames contain hyphens.
   */
  async uciAddAnonymousSection(config: string, type: string): Promise<string> {
    validateName(config, "UCI config name");
    validateName(type, "UCI section type");
    const id = (await this.executeCommand(`uci add ${config} ${type}`)).trim();
    if (!/^[A-Za-z0-9_]+$/.test(id)) {
      throw new Error(`Unexpected output from 'uci add ${config} ${type}': ${JSON.stringify(id)}`);
    }
    return id;
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
   * Read at most `maxBytes` of a file and report its real size, so a large
   * log or archive cannot flood the caller's context unnoticed.
   */
  async readFileLimited(path: string, maxBytes: number): Promise<LimitedFileContent> {
    const quoted = shellQuote(path);
    // First line: size in bytes; the rest: the (possibly truncated) content.
    const output = await this.executeCommand(
      `wc -c < ${quoted} && head -c ${maxBytes} ${quoted}`
    );
    const nl = output.indexOf("\n");
    const sizeText = (nl === -1 ? output : output.slice(0, nl)).trim();
    const size = Number(sizeText);
    if (nl === -1 || !Number.isInteger(size)) {
      throw new Error(`Unexpected output while reading ${path}: ${output.slice(0, 100)}`);
    }
    return {
      content: output.slice(nl + 1),
      size,
      truncated: size > maxBytes,
    };
  }

  /**
   * Write content to a file on the OpenWRT device.
   * Content is streamed to stdin of `cat`, so the file is written
   * byte-for-byte (a heredoc would force an extra trailing newline).
   * The resulting file size is read back and compared with the payload so a
   * dropped trailing newline or a short write surfaces immediately.
   * @param path - file path
   * @param content - content to write
   * @returns number of bytes written
   */
  async writeFile(path: string, content: string): Promise<number> {
    const quoted = shellQuote(path);
    const output = await this.executeCommand(`cat > ${quoted} && wc -c < ${quoted}`, { stdin: content });
    return verifyWrittenSize(path, output, Buffer.byteLength(content, "utf8"));
  }

  /**
   * Append content to a file byte-for-byte and verify the size grew by
   * exactly the payload length.
   * @returns the file size after appending
   */
  async appendFile(path: string, content: string): Promise<number> {
    const quoted = shellQuote(path);
    const before = await this.executeCommandRaw(`wc -c < ${quoted}`);
    const sizeBefore = before.code === 0 ? Number(before.stdout.trim()) : 0;
    const output = await this.executeCommand(`cat >> ${quoted} && wc -c < ${quoted}`, { stdin: content });
    return verifyWrittenSize(
      path,
      output,
      (Number.isInteger(sizeBefore) ? sizeBefore : 0) + Buffer.byteLength(content, "utf8")
    );
  }
}

function verifyWrittenSize(path: string, wcOutput: string, expected: number): number {
  const actual = Number(wcOutput.trim());
  if (!Number.isInteger(actual)) {
    throw new Error(`Could not verify write to ${path}: unexpected wc output ${JSON.stringify(wcOutput)}`);
  }
  if (actual !== expected) {
    throw new Error(
      `Write verification failed for ${path}: expected ${expected} bytes on disk, found ${actual}`
    );
  }
  return actual;
}

function formatCommandFailure(result: CommandResult): string {
  let message = `Command failed with code ${result.code}: ${result.stderr}`;
  const stdout = result.stdout.trim();
  if (stdout.length > 0) {
    const shown =
      stdout.length > ERROR_STDOUT_LIMIT
        ? stdout.slice(0, ERROR_STDOUT_LIMIT) + `\n… (${stdout.length - ERROR_STDOUT_LIMIT} more chars)`
        : stdout;
    message += `\nstdout: ${shown}`;
  }
  return message;
}
