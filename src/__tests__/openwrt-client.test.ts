import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// --- Shared mock state ---
interface MockBehavior {
  connectAction: "ready" | "error";
  connectError?: Error;
  execHandler?: (command: string, cb: (err: Error | null, stream: any) => void) => void;
}

let nextBehavior: MockBehavior = { connectAction: "ready" };
let lastMockClient: any = null;

class MockStream extends EventEmitter {
  stderr = new EventEmitter();
  written: string | undefined = undefined;
  close() {}
  end(data?: string) {
    this.written = data;
  }
}

// Mock the ssh2 module before importing OpenWRTClient
vi.mock("ssh2", () => {
  return {
    Client: vi.fn().mockImplementation(function (this: any) {
      const emitter = new EventEmitter();
      this._emitter = emitter;
      this.endCalled = false;

      // .on() must return `this` for chaining: client.on(...).on(...).connect(...)
      this.on = function (event: string, handler: (...args: any[]) => void) {
        emitter.on(event, handler);
        return this;
      };

      this.connect = function (_opts: any) {
        const behavior = nextBehavior;
        process.nextTick(() => {
          if (behavior.connectAction === "ready") {
            emitter.emit("ready");
          } else {
            emitter.emit("error", behavior.connectError || new Error("Connection failed"));
          }
        });
        return this;
      };

      this.exec = function (command: string, cb: (err: Error | null, stream: any) => void) {
        if (nextBehavior.execHandler) {
          nextBehavior.execHandler(command, cb);
        } else {
          const stream = new MockStream();
          cb(null, stream);
          process.nextTick(() => {
            stream.emit("close", 0);
          });
        }
      };

      this.end = function () {
        this.endCalled = true;
      };

      lastMockClient = this;
      return this;
    }),
  };
});

// Import after mock setup
import { OpenWRTClient } from "../openwrt-client.js";

describe("OpenWRTClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextBehavior = { connectAction: "ready" };
    lastMockClient = null;
  });

  function makeClient() {
    return new OpenWRTClient({
      host: "192.168.1.1",
      port: 22,
      username: "root",
      password: "password",
    });
  }

  describe("connect()", () => {
    it("sets connected state on successful connection", async () => {
      const client = makeClient();
      await client.connect();
      expect((client as any).connected).toBe(true);
    });

    it("concurrent connect() calls share the same promise", async () => {
      const client = makeClient();
      const p1 = client.connect();
      const p2 = client.connect();
      await Promise.all([p1, p2]);
      expect((client as any).connected).toBe(true);
    });

    it("rejects all waiters when connection fails", async () => {
      nextBehavior = { connectAction: "error", connectError: new Error("Connection refused") };
      const client = makeClient();
      await expect(client.connect()).rejects.toThrow("Connection refused");
    });

    it("clears connectPromise after failure so retry works", async () => {
      nextBehavior = { connectAction: "error", connectError: new Error("fail") };
      const client = makeClient();
      await expect(client.connect()).rejects.toThrow("fail");
      expect((client as any).connectPromise).toBeNull();

      // Now succeed
      nextBehavior = { connectAction: "ready" };
      await client.connect();
      expect((client as any).connected).toBe(true);
    });
  });

  describe("executeCommand()", () => {
    it("returns stdout on success", async () => {
      nextBehavior = {
        connectAction: "ready",
        execHandler: (_cmd, cb) => {
          const stream = new MockStream();
          cb(null, stream);
          process.nextTick(() => {
            stream.emit("data", Buffer.from("output data"));
            stream.emit("close", 0);
          });
        },
      };

      const client = makeClient();
      await client.connect();
      const result = await client.executeCommand("echo hello");
      expect(result).toBe("output data");
    });

    it("rejects on non-zero exit code with stderr", async () => {
      nextBehavior = {
        connectAction: "ready",
        execHandler: (_cmd, cb) => {
          const stream = new MockStream();
          cb(null, stream);
          process.nextTick(() => {
            stream.stderr.emit("data", Buffer.from("error output"));
            stream.emit("close", 1);
          });
        },
      };

      const client = makeClient();
      await client.connect();
      await expect(client.executeCommand("bad cmd")).rejects.toThrow(
        "Command failed with code 1: error output"
      );
    });

    it("rejects on timeout and closes stream", async () => {
      let streamRef: MockStream | null = null;
      nextBehavior = {
        connectAction: "ready",
        execHandler: (_cmd, cb) => {
          const stream = new MockStream();
          streamRef = stream;
          vi.spyOn(stream, "close");
          cb(null, stream);
          // Never emit close — let timeout fire
        },
      };

      const client = makeClient();
      await client.connect();
      await expect(client.executeCommand("sleep 100", { timeout: 50 })).rejects.toThrow("timed out");
      expect(streamRef!.close).toHaveBeenCalled();
    });

    it("rejects when channel closes without exit code and marks disconnected", async () => {
      nextBehavior = {
        connectAction: "ready",
        execHandler: (_cmd, cb) => {
          const stream = new MockStream();
          cb(null, stream);
          process.nextTick(() => {
            // Connection drop: close event without an exit status
            stream.emit("close", null);
          });
        },
      };

      const client = makeClient();
      await client.connect();
      await expect(client.executeCommand("reboot")).rejects.toThrow(
        "closed without exit code"
      );
      expect((client as any).connected).toBe(false);
    });

    it("streams stdin to the command when provided", async () => {
      let streamRef: MockStream | null = null;
      nextBehavior = {
        connectAction: "ready",
        execHandler: (_cmd, cb) => {
          const stream = new MockStream();
          streamRef = stream;
          cb(null, stream);
          process.nextTick(() => {
            stream.emit("close", 0);
          });
        },
      };

      const client = makeClient();
      await client.connect();
      await client.executeCommand("cat > /tmp/x", { stdin: "payload" });
      expect(streamRef!.written).toBe("payload");
    });
  });

  describe("executeCommandRaw()", () => {
    it("resolves with the exit code instead of rejecting", async () => {
      nextBehavior = {
        connectAction: "ready",
        execHandler: (_cmd, cb) => {
          const stream = new MockStream();
          cb(null, stream);
          process.nextTick(() => {
            stream.emit("data", Buffer.from("partial"));
            stream.stderr.emit("data", Buffer.from("oops"));
            stream.emit("close", 3);
          });
        },
      };

      const client = makeClient();
      await client.connect();
      const result = await client.executeCommandRaw("false");
      expect(result).toEqual({ code: 3, stdout: "partial", stderr: "oops" });
    });

    it("reassembles multi-byte UTF-8 characters split across chunks", async () => {
      const bytes = Buffer.from("привет мир", "utf8"); // 19 bytes
      nextBehavior = {
        connectAction: "ready",
        execHandler: (_cmd, cb) => {
          const stream = new MockStream();
          cb(null, stream);
          process.nextTick(() => {
            // Split in the middle of the 2-byte "и" (bytes 2..3)
            stream.emit("data", bytes.subarray(0, 3));
            stream.emit("data", bytes.subarray(3));
            stream.emit("close", 0);
          });
        },
      };

      const client = makeClient();
      await client.connect();
      expect(await client.executeCommand("cat")).toBe("привет мир");
    });

    it("executeCommand error message includes stdout of a failed command", async () => {
      nextBehavior = {
        connectAction: "ready",
        execHandler: (_cmd, cb) => {
          const stream = new MockStream();
          cb(null, stream);
          process.nextTick(() => {
            stream.emit("data", Buffer.from("step 1 ok\nstep 2 ok"));
            stream.stderr.emit("data", Buffer.from("step 3 failed"));
            stream.emit("close", 1);
          });
        },
      };

      const client = makeClient();
      await client.connect();
      await expect(client.executeCommand("script.sh")).rejects.toThrow(
        /Command failed with code 1: step 3 failed\nstdout: step 1 ok\nstep 2 ok/
      );
    });
  });

  describe("UCI helpers", () => {
    /** Route commands to canned {code, stdout} responses; records commands and stdin. */
    function routeCommands(routes: (cmd: string) => { code: number; stdout?: string; stderr?: string } | undefined) {
      const seen: { cmd: string; stdin?: string }[] = [];
      nextBehavior = {
        connectAction: "ready",
        execHandler: (cmd, cb) => {
          const stream = new MockStream();
          cb(null, stream);
          process.nextTick(() => {
            seen.push({ cmd, stdin: stream.written });
            const r = routes(cmd) ?? { code: 0, stdout: "" };
            if (r.stdout) stream.emit("data", Buffer.from(r.stdout));
            if (r.stderr) stream.stderr.emit("data", Buffer.from(r.stderr));
            stream.emit("close", r.code);
          });
        },
      };
      return seen;
    }

    it("uciSetSecret feeds the assignment to uci batch via stdin", async () => {
      const seen = routeCommands(() => undefined);
      const client = makeClient();
      await client.connect();
      await client.uciSetSecret("network", "wg0", "private_key", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");

      expect(seen).toHaveLength(1);
      expect(seen[0].cmd).toBe("uci batch");
      expect(seen[0].stdin).toBe("set network.wg0.private_key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n");
    });

    it("uciSetSecret treats stderr from uci batch as failure", async () => {
      routeCommands(() => ({ code: 0, stderr: "uci: Invalid argument\n" }));
      const client = makeClient();
      await client.connect();
      await expect(
        client.uciSetSecret("network", "nope", "private_key", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
      ).rejects.toThrow("uci batch failed");
    });

    it("uciSetSecret rejects values that could inject batch commands", async () => {
      const seen = routeCommands(() => undefined);
      const client = makeClient();
      await client.connect();
      await expect(client.uciSetSecret("network", "wg0", "private_key", "a\nset network.lan.proto=none")).rejects.toThrow(
        "Invalid value"
      );
      await expect(client.uciSetSecret("network", "wg0", "private_key", "it's")).rejects.toThrow("Invalid value");
      expect(seen).toHaveLength(0);
    });

    it("uciAddSection refuses to re-type an existing section", async () => {
      const seen = routeCommands((cmd) =>
        cmd === "uci -q get network.lan" ? { code: 0, stdout: "interface\n" } : undefined
      );
      const client = makeClient();
      await client.connect();
      await expect(client.uciAddSection("network", "lan", "route")).rejects.toThrow("already exists (type 'interface')");
      expect(seen.some((s) => s.cmd.startsWith("uci set"))).toBe(false);
    });

    it("uciAddSection with allowExisting is a no-op for a same-typed section", async () => {
      const seen = routeCommands((cmd) =>
        cmd === "uci -q get dhcp.lan" ? { code: 0, stdout: "dhcp\n" } : undefined
      );
      const client = makeClient();
      await client.connect();
      await client.uciAddSection("dhcp", "lan", "dhcp", { allowExisting: true });
      expect(seen.map((s) => s.cmd)).toEqual(["uci -q get dhcp.lan"]);
    });

    it("uciAddSection creates a missing section", async () => {
      const seen = routeCommands((cmd) => (cmd.startsWith("uci -q get") ? { code: 1 } : undefined));
      const client = makeClient();
      await client.connect();
      await client.uciAddSection("network", "r1", "route");
      expect(seen.map((s) => s.cmd)).toEqual(["uci -q get network.r1", "uci set network.r1=route"]);
    });

    it("uciAddAnonymousSection returns the generated id", async () => {
      routeCommands((cmd) => (cmd === "uci add dhcp host" ? { code: 0, stdout: "cfg0a3b5c\n" } : undefined));
      const client = makeClient();
      await client.connect();
      expect(await client.uciAddAnonymousSection("dhcp", "host")).toBe("cfg0a3b5c");
    });

    it("uciSet validates path components", async () => {
      routeCommands(() => undefined);
      const client = makeClient();
      await client.connect();
      await expect(client.uciSet("network", "lan; rm -rf /", "proto", "x")).rejects.toThrow("Invalid UCI section");
      await expect(client.uciSet("net work", "lan", "proto", "x")).rejects.toThrow("Invalid UCI config name");
      // anonymous references are fine
      await client.uciSet("dhcp", "@dnsmasq[0]", "noresolv", "1");
    });
  });

  describe("readFileLimited()", () => {
    it("parses size line and content, flags truncation", async () => {
      let capturedCommand = "";
      nextBehavior = {
        connectAction: "ready",
        execHandler: (cmd, cb) => {
          capturedCommand = cmd;
          const stream = new MockStream();
          cb(null, stream);
          process.nextTick(() => {
            stream.emit("data", Buffer.from("1000\nfirst\nlines"));
            stream.emit("close", 0);
          });
        },
      };

      const client = makeClient();
      await client.connect();
      const result = await client.readFileLimited("/tmp/big", 11);
      expect(capturedCommand).toBe("wc -c < '/tmp/big' && head -c 11 '/tmp/big'");
      expect(result).toEqual({ content: "first\nlines", size: 1000, truncated: true });
    });
  });

  describe("appendFile()", () => {
    it("verifies the file grew by exactly the payload", async () => {
      const cmds: string[] = [];
      nextBehavior = {
        connectAction: "ready",
        execHandler: (cmd, cb) => {
          cmds.push(cmd);
          const stream = new MockStream();
          cb(null, stream);
          process.nextTick(() => {
            stream.emit("data", Buffer.from(cmd.startsWith("cat >>") ? "15\n" : "10\n"));
            stream.emit("close", 0);
          });
        },
      };

      const client = makeClient();
      await client.connect();
      expect(await client.appendFile("/tmp/f", "hello")).toBe(15);
      expect(cmds).toEqual(["wc -c < '/tmp/f'", "cat >> '/tmp/f' && wc -c < '/tmp/f'"]);
    });
  });

  describe("ubusCall()", () => {
    it("constructs correct command with shellQuote", async () => {
      let capturedCommand = "";
      nextBehavior = {
        connectAction: "ready",
        execHandler: (cmd, cb) => {
          capturedCommand = cmd;
          const stream = new MockStream();
          cb(null, stream);
          process.nextTick(() => {
            stream.emit("data", Buffer.from('{"result": true}'));
            stream.emit("close", 0);
          });
        },
      };

      const client = makeClient();
      await client.connect();
      await client.ubusCall("system", "info");

      expect(capturedCommand).toBe("ubus call system info '{}'");
    });

    it("handles params with single quotes safely", async () => {
      let capturedCommand = "";
      nextBehavior = {
        connectAction: "ready",
        execHandler: (cmd, cb) => {
          capturedCommand = cmd;
          const stream = new MockStream();
          cb(null, stream);
          process.nextTick(() => {
            stream.emit("data", Buffer.from('{"ok": true}'));
            stream.emit("close", 0);
          });
        },
      };

      const client = makeClient();
      await client.connect();
      await client.ubusCall("test", "method", { name: "it's" });

      expect(capturedCommand).toContain("'\\''");
    });
  });

  describe("writeFile()", () => {
    /** Emulates `cat > f && wc -c < f`: reports the byte length of what was written. */
    function captureWrite(reportedSize?: number) {
      const captured = { command: "", stream: null as MockStream | null };
      nextBehavior = {
        connectAction: "ready",
        execHandler: (cmd, cb) => {
          captured.command = cmd;
          const stream = new MockStream();
          captured.stream = stream;
          cb(null, stream);
          process.nextTick(() => {
            const size = reportedSize ?? Buffer.byteLength(stream.written ?? "", "utf8");
            stream.emit("data", Buffer.from(`${size}\n`));
            stream.emit("close", 0);
          });
        },
      };
      return captured;
    }

    it("streams content to stdin of cat with quoted path and verifies the size", async () => {
      const captured = captureWrite();

      const client = makeClient();
      await client.connect();
      const bytes = await client.writeFile("/tmp/test", "hello world");

      expect(captured.command).toBe("cat > '/tmp/test' && wc -c < '/tmp/test'");
      expect(captured.stream!.written).toBe("hello world");
      expect(bytes).toBe(11);
    });

    it("counts UTF-8 bytes, not characters, when verifying", async () => {
      captureWrite();
      const client = makeClient();
      await client.connect();
      expect(await client.writeFile("/tmp/test", "привет")).toBe(12);
    });

    it("throws when the on-disk size differs from the payload", async () => {
      captureWrite(10); // one byte short — e.g. a dropped trailing newline
      const client = makeClient();
      await client.connect();
      await expect(client.writeFile("/tmp/test", "hello world")).rejects.toThrow(
        "expected 11 bytes on disk, found 10"
      );
    });

    it("writes content byte-for-byte without adding a trailing newline", async () => {
      const captured = captureWrite();

      const client = makeClient();
      await client.connect();
      await client.writeFile("/tmp/test", "no trailing newline");

      expect(captured.stream!.written).toBe("no trailing newline");
    });

    it("does not double a trailing newline that is already present", async () => {
      const captured = captureWrite();

      const client = makeClient();
      await client.connect();
      await client.writeFile("/tmp/test", "line1\nline2\n");

      expect(captured.stream!.written).toBe("line1\nline2\n");
    });
  });

  describe("readFile()", () => {
    it("uses shellQuote for path", async () => {
      let capturedCommand = "";
      nextBehavior = {
        connectAction: "ready",
        execHandler: (cmd, cb) => {
          capturedCommand = cmd;
          const stream = new MockStream();
          cb(null, stream);
          process.nextTick(() => {
            stream.emit("data", Buffer.from("file content"));
            stream.emit("close", 0);
          });
        },
      };

      const client = makeClient();
      await client.connect();
      await client.readFile("/etc/config/network");

      expect(capturedCommand).toBe("cat '/etc/config/network'");
    });
  });

  describe("disconnect()", () => {
    it("calls client.end() and sets connected to false", async () => {
      const client = makeClient();
      await client.connect();
      expect((client as any).connected).toBe(true);

      await client.disconnect();
      expect((client as any).connected).toBe(false);
      expect(lastMockClient.endCalled).toBe(true);
    });
  });

  describe("ensureConnected()", () => {
    it("reconnects when disconnected", async () => {
      nextBehavior = {
        connectAction: "ready",
        execHandler: (_cmd, cb) => {
          const stream = new MockStream();
          cb(null, stream);
          process.nextTick(() => {
            stream.emit("data", Buffer.from("ok"));
            stream.emit("close", 0);
          });
        },
      };

      const client = makeClient();
      await client.connect();
      // Simulate disconnect
      (client as any).connected = false;

      const result = await client.executeCommand("test");
      expect(result).toBe("ok");
    });
  });
});
