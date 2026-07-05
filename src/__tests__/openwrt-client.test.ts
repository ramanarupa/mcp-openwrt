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
    function captureWrite() {
      const captured = { command: "", stream: null as MockStream | null };
      nextBehavior = {
        connectAction: "ready",
        execHandler: (cmd, cb) => {
          captured.command = cmd;
          const stream = new MockStream();
          captured.stream = stream;
          cb(null, stream);
          process.nextTick(() => {
            stream.emit("close", 0);
          });
        },
      };
      return captured;
    }

    it("streams content to stdin of cat with quoted path", async () => {
      const captured = captureWrite();

      const client = makeClient();
      await client.connect();
      await client.writeFile("/tmp/test", "hello world");

      expect(captured.command).toBe("cat > '/tmp/test'");
      expect(captured.stream!.written).toBe("hello world");
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
