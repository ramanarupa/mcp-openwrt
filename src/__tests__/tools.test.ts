import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenWRTClient } from "../openwrt-client.js";
import { fileTools } from "../tools/files.js";
import { systemTools } from "../tools/system.js";
import { serviceTools } from "../tools/services.js";
import { wireguardTools } from "../tools/wireguard.js";
import { dnsTools } from "../tools/dns.js";
import { networkTools } from "../tools/network.js";
import { scriptTools } from "../tools/scripts.js";

// Create a mock client that records all calls
function createMockClient() {
  const calls: { method: string; args: any[] }[] = [];

  return {
    calls,
    connect: vi.fn(async () => {
      calls.push({ method: "connect", args: [] });
    }),
    executeCommand: vi.fn(async (cmd: string, options?: { timeout?: number; stdin?: string }) => {
      calls.push({ method: "executeCommand", args: [cmd, options] });
      return "";
    }),
    ubusCall: vi.fn(async (path: string, method: string, params?: any) => {
      calls.push({ method: "ubusCall", args: [path, method, params] });
      return { interface: [] };
    }),
    uciSet: vi.fn(async (config: string, section: string, option: string, value: string) => {
      calls.push({ method: "uciSet", args: [config, section, option, value] });
    }),
    uciAddSection: vi.fn(async (config: string, section: string, type: string) => {
      calls.push({ method: "uciAddSection", args: [config, section, type] });
    }),
    uciCommit: vi.fn(async (config?: string) => {
      calls.push({ method: "uciCommit", args: [config] });
    }),
    uciRevert: vi.fn(async (config?: string) => {
      calls.push({ method: "uciRevert", args: [config] });
    }),
    uciShow: vi.fn(async (config: string) => {
      calls.push({ method: "uciShow", args: [config] });
      return "";
    }),
    readFile: vi.fn(async (path: string) => {
      calls.push({ method: "readFile", args: [path] });
      return "file content";
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      calls.push({ method: "writeFile", args: [path, content] });
    }),
    reloadNetwork: vi.fn(async () => {
      calls.push({ method: "reloadNetwork", args: [] });
    }),
    reloadDnsmasq: vi.fn(async () => {
      calls.push({ method: "reloadDnsmasq", args: [] });
    }),
  } as unknown as OpenWRTClient & { calls: typeof calls };
}

function findTool(tools: any[], name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

describe("File tools", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  it("file_write with mode uses shellQuote and validateMode", async () => {
    const tool = findTool(fileTools, "openwrt_file_write");
    await tool.handler(client, { path: "/tmp/test file.txt", content: "hello", mode: "755" });

    const chmodCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].startsWith("chmod")
    );
    expect(chmodCall).toBeDefined();
    expect(chmodCall!.args[0]).toBe("chmod 755 '/tmp/test file.txt'");
  });

  it("file_write with invalid mode throws", async () => {
    const tool = findTool(fileTools, "openwrt_file_write");
    await expect(
      tool.handler(client, { path: "/tmp/test", content: "hello", mode: "999" })
    ).rejects.toThrow("Invalid file mode");
  });

  it("file_delete without confirm returns not-confirmed", async () => {
    const tool = findTool(fileTools, "openwrt_file_delete");
    const result = await tool.handler(client, { path: "/tmp/test", confirm: false });
    expect(result.success).toBe(false);
    expect(result.message).toContain("not confirmed");
    // No command should have been executed
    expect(client.calls.filter((c) => c.method === "executeCommand")).toHaveLength(0);
  });

  it("file_delete with confirm uses shellQuote", async () => {
    const tool = findTool(fileTools, "openwrt_file_delete");
    await tool.handler(client, { path: "/tmp/test'file", confirm: true });

    const rmCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].startsWith("rm")
    );
    expect(rmCall).toBeDefined();
    expect(rmCall!.args[0]).toBe("rm -f '/tmp/test'\\''file'");
  });

  it("file_search_content uses -F and shellQuote", async () => {
    const tool = findTool(fileTools, "openwrt_file_search_content");
    await tool.handler(client, { directory: "/etc", pattern: "test$pattern" });

    const grepCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].includes("grep")
    );
    expect(grepCall).toBeDefined();
    expect(grepCall!.args[0]).toContain("-F --");
    expect(grepCall!.args[0]).toContain("'test$pattern'");
    expect(grepCall!.args[0]).toContain("'/etc'");
  });

  it("file_backup uses shellQuote on both args", async () => {
    const tool = findTool(fileTools, "openwrt_file_backup");
    await tool.handler(client, { path: "/etc/config", backup_path: "/tmp/backup" });

    const cpCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].startsWith("cp")
    );
    expect(cpCall).toBeDefined();
    expect(cpCall!.args[0]).toBe("cp -r '/etc/config' '/tmp/backup'");
  });

  it("file_read lets errors propagate (no try-catch)", async () => {
    const tool = findTool(fileTools, "openwrt_file_read");
    (client as any).readFile = vi.fn(async () => {
      throw new Error("File not found");
    });

    await expect(tool.handler(client, { path: "/nonexistent" })).rejects.toThrow("File not found");
  });

  it("file_append streams content via stdin byte-for-byte", async () => {
    const tool = findTool(fileTools, "openwrt_file_append");
    await tool.handler(client, { path: "/tmp/test", content: "extra line" });

    const appendCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].startsWith("cat >>")
    );
    expect(appendCall).toBeDefined();
    expect(appendCall!.args[0]).toBe("cat >> '/tmp/test'");
    expect(appendCall!.args[1]).toEqual({ stdin: "extra line" });
  });
});

describe("System tools", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  it("package_install uses shellQuote", async () => {
    const tool = findTool(systemTools, "openwrt_package_install");
    await tool.handler(client, { package: "luci-app-test" });

    const installCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].includes("apk add")
    );
    expect(installCall).toBeDefined();
    expect(installCall!.args[0]).toBe("apk add 'luci-app-test'");
  });

  it("package_remove uses shellQuote", async () => {
    const tool = findTool(systemTools, "openwrt_package_remove");
    await tool.handler(client, { package: "test-pkg" });

    const removeCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].includes("apk del")
    );
    expect(removeCall).toBeDefined();
    expect(removeCall!.args[0]).toBe("apk del 'test-pkg'");
  });

  it("service_control with invalid service name throws", async () => {
    const tool = findTool(systemTools, "openwrt_service_control");
    await expect(
      tool.handler(client, { service: "../etc/passwd", action: "start" })
    ).rejects.toThrow("Invalid service name");
  });

  it("service_control with invalid action throws", async () => {
    const tool = findTool(systemTools, "openwrt_service_control");
    await expect(
      tool.handler(client, { service: "network", action: "exploit" })
    ).rejects.toThrow("Invalid action");
  });

  it("service_control with valid inputs succeeds", async () => {
    const tool = findTool(systemTools, "openwrt_service_control");
    const result = await tool.handler(client, { service: "network", action: "restart" });
    expect(result.success).toBe(true);
  });

  it("system_reboot without confirm returns not-confirmed", async () => {
    const tool = findTool(systemTools, "openwrt_system_reboot");
    const result = await tool.handler(client, { confirm: false });
    expect(result.success).toBe(false);
    expect(result.message).toContain("not confirmed");
  });

  it("execute_command without confirm returns not-confirmed", async () => {
    const tool = findTool(systemTools, "openwrt_system_execute_command");
    const result = await tool.handler(client, { command: "ls", confirm: false });
    expect(result.success).toBe(false);
    expect(result.message).toContain("not confirmed");
    expect(client.calls.filter((c) => c.method === "executeCommand")).toHaveLength(0);
  });

  it("execute_command with confirm executes the command", async () => {
    const tool = findTool(systemTools, "openwrt_system_execute_command");
    const result = await tool.handler(client, { command: "uptime", confirm: true });
    expect(result.success).toBe(true);
    const execCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0] === "uptime"
    );
    expect(execCall).toBeDefined();
  });

  it("package_list_installed filter uses -F and shellQuote", async () => {
    const tool = findTool(systemTools, "openwrt_package_list_installed");
    await tool.handler(client, { filter: "wire$guard" });

    const grepCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].includes("grep")
    );
    expect(grepCall).toBeDefined();
    expect(grepCall!.args[0]).toContain("-F --");
    expect(grepCall!.args[0]).toContain("'wire$guard'");
  });

  it("package_list_installed returns empty result when filter matches nothing", async () => {
    (client as any).executeCommand = vi.fn(async (cmd: string) => {
      client.calls.push({ method: "executeCommand", args: [cmd] });
      throw new Error("Command failed with code 1: ");
    });

    const tool = findTool(systemTools, "openwrt_package_list_installed");
    const result = await tool.handler(client, { filter: "nonexistent" });
    expect(result.success).toBe(true);
    expect(result.packages).toBe("");
  });

  it("package_install uses an extended timeout", async () => {
    const tool = findTool(systemTools, "openwrt_package_install");
    await tool.handler(client, { package: "htop" });

    const installCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].includes("apk add")
    );
    expect(installCall!.args[1]?.timeout).toBeGreaterThan(30_000);
  });

  it("service_control status masks the non-zero exit code", async () => {
    const tool = findTool(systemTools, "openwrt_service_control");
    await tool.handler(client, { service: "dnsmasq", action: "status" });

    const statusCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].includes("status")
    );
    expect(statusCall).toBeDefined();
    expect(statusCall!.args[0]).toBe("/etc/init.d/dnsmasq status 2>&1 || true");
  });

  it("system_reboot with confirm tolerates a dropped channel", async () => {
    (client as any).executeCommand = vi.fn(async (cmd: string) => {
      client.calls.push({ method: "executeCommand", args: [cmd] });
      throw new Error("Command channel closed without exit code (connection may have dropped): reboot");
    });

    const tool = findTool(systemTools, "openwrt_system_reboot");
    const result = await tool.handler(client, { confirm: true });
    expect(result.success).toBe(true);
    // connect() must run first so an unreachable device still fails properly
    expect(client.calls.some((c) => c.method === "connect")).toBe(true);
  });
});

describe("Service tools", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  it("service_create with special chars in name throws", async () => {
    const tool = findTool(serviceTools, "openwrt_service_create");
    await expect(
      tool.handler(client, { name: "my;service", script_content: "#!/bin/sh" })
    ).rejects.toThrow("Invalid service name");
  });

  it("service_create with valid name uses shellQuote for chmod and enable", async () => {
    const tool = findTool(serviceTools, "openwrt_service_create");
    await tool.handler(client, { name: "myapp", script_content: "#!/bin/sh", enable: true });

    const chmodCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].includes("chmod")
    );
    expect(chmodCall).toBeDefined();
    expect(chmodCall!.args[0]).toBe("chmod +x '/etc/init.d/myapp'");

    const enableCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].includes("enable")
    );
    expect(enableCall).toBeDefined();
    expect(enableCall!.args[0]).toBe("'/etc/init.d/myapp' enable");
  });

  it("service_delete validates name", async () => {
    const tool = findTool(serviceTools, "openwrt_service_delete");
    await expect(
      tool.handler(client, { name: "bad/name", confirm: true })
    ).rejects.toThrow("Invalid service name");
  });

  it("service_view validates name", async () => {
    const tool = findTool(serviceTools, "openwrt_service_view");
    await expect(
      tool.handler(client, { name: "$(cmd)" })
    ).rejects.toThrow("Invalid service name");
  });

  it("service_create_simple generates a procd script with escaped command", async () => {
    const tool = findTool(serviceTools, "openwrt_service_create_simple");
    await tool.handler(client, { name: "myapp", start_command: "/usr/bin/myapp --flag" });

    const writeCall = client.calls.find((c) => c.method === "writeFile");
    expect(writeCall).toBeDefined();
    const script = writeCall!.args[1];
    expect(script).toContain("USE_PROCD=1");
    expect(script).toContain("procd_set_param command /bin/sh -c '/usr/bin/myapp --flag'");
    expect(script).toContain("procd_set_param respawn");
    // No custom stop_command — procd handles stop itself
    expect(script).not.toContain("stop_service()");
  });

  it("service_create_simple includes stop_service when stop_command given", async () => {
    const tool = findTool(serviceTools, "openwrt_service_create_simple");
    await tool.handler(client, {
      name: "myapp",
      start_command: "/usr/bin/myapp",
      stop_command: "rm -f /tmp/myapp.lock",
    });

    const writeCall = client.calls.find((c) => c.method === "writeFile");
    expect(writeCall!.args[1]).toContain("stop_service()");
    expect(writeCall!.args[1]).toContain("rm -f /tmp/myapp.lock");
  });

  it("cron_add writes the crontab via stdin with trailing newline", async () => {
    const tool = findTool(serviceTools, "openwrt_cron_add");
    await tool.handler(client, { schedule: "0 2 * * *", command: "/root/backup.sh", comment: "nightly" });

    const cronCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0] === "crontab -"
    );
    expect(cronCall).toBeDefined();
    const stdin = cronCall!.args[1].stdin as string;
    expect(stdin).toContain("# nightly\n0 2 * * * /root/backup.sh");
    expect(stdin.endsWith("\n")).toBe(true);
  });

  it("cron_add appends to an existing crontab", async () => {
    (client as any).executeCommand = vi.fn(async (cmd: string, options?: any) => {
      client.calls.push({ method: "executeCommand", args: [cmd, options] });
      if (cmd === "crontab -l") return "0 1 * * * /old/job\n";
      return "";
    });

    const tool = findTool(serviceTools, "openwrt_cron_add");
    await tool.handler(client, { schedule: "0 2 * * *", command: "/root/backup.sh" });

    const cronCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0] === "crontab -"
    );
    expect(cronCall!.args[1].stdin).toBe("0 1 * * * /old/job\n0 2 * * * /root/backup.sh\n");
  });

  it("cron_list treats busybox 'can't open' error as empty crontab", async () => {
    (client as any).executeCommand = vi.fn(async (cmd: string) => {
      client.calls.push({ method: "executeCommand", args: [cmd] });
      if (cmd === "crontab -l") {
        throw new Error("Command failed with code 1: crontab: can't open 'root': No such file or directory");
      }
      return "";
    });

    const tool = findTool(serviceTools, "openwrt_cron_list");
    const result = await tool.handler(client, {});
    expect(result.success).toBe(true);
    expect(result.crontab).toBe("");
  });

  it("cron_remove filters entries and their comment lines via stdin", async () => {
    (client as any).executeCommand = vi.fn(async (cmd: string, options?: any) => {
      client.calls.push({ method: "executeCommand", args: [cmd, options] });
      if (cmd === "crontab -l") {
        return "# keep this\n0 1 * * * /old/job\n# remove me\n0 2 * * * /remove/this";
      }
      return "";
    });

    const tool = findTool(serviceTools, "openwrt_cron_remove");
    const result = await tool.handler(client, { pattern: "/remove/this", confirm: true });
    expect(result.success).toBe(true);
    expect(result.message).toContain("1 cron job(s) removed");

    const cronCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0] === "crontab -"
    );
    expect(cronCall).toBeDefined();
    const stdin = cronCall!.args[1].stdin as string;
    expect(stdin).not.toContain("/remove/this");
    expect(stdin).not.toContain("# remove me");
    expect(stdin).toContain("/old/job");
    expect(stdin).toContain("# keep this");
  });

  it("cron_remove rejects an empty pattern", async () => {
    const tool = findTool(serviceTools, "openwrt_cron_remove");
    await expect(tool.handler(client, { pattern: "", confirm: true })).rejects.toThrow(
      "non-empty"
    );
  });
});

describe("WireGuard tools", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    // Mock wg genkey and wg pubkey responses
    (client as any).executeCommand = vi.fn(async (cmd: string) => {
      client.calls.push({ method: "executeCommand", args: [cmd] });
      if (cmd === "wg genkey") return "privatekey123\n";
      if (cmd.includes("wg pubkey")) return "publickey456\n";
      return "";
    });
  });

  it("create_interface validates name", async () => {
    const tool = findTool(wireguardTools, "openwrt_wireguard_create_interface");
    await expect(
      tool.handler(client, { name: "bad;name", listen_port: 51820, addresses: ["10.0.0.1/24"] })
    ).rejects.toThrow("Invalid interface name");
  });

  it("create_interface quotes private key in echo | wg pubkey", async () => {
    const tool = findTool(wireguardTools, "openwrt_wireguard_create_interface");
    await tool.handler(client, { name: "wg0", listen_port: 51820, addresses: ["10.0.0.1/24"] });

    const pubkeyCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].includes("wg pubkey")
    );
    expect(pubkeyCall).toBeDefined();
    // Should use shellQuote, not double quotes
    expect(pubkeyCall!.args[0]).toContain("echo '");
    expect(pubkeyCall!.args[0]).not.toContain('"');
  });

  it("create_interface quotes addresses in uci add_list", async () => {
    const tool = findTool(wireguardTools, "openwrt_wireguard_create_interface");
    await tool.handler(client, { name: "wg0", listen_port: 51820, addresses: ["10.0.0.1/24"] });

    const addrCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].includes("uci add_list") && c.args[0].includes("addresses")
    );
    expect(addrCall).toBeDefined();
    expect(addrCall!.args[0]).toContain("'10.0.0.1/24'");
  });

  it("add_peer validates interface and peer_name", async () => {
    const tool = findTool(wireguardTools, "openwrt_wireguard_add_peer");
    await expect(
      tool.handler(client, {
        interface: "wg0",
        peer_name: "bad peer",
        public_key: "key",
        allowed_ips: ["10.0.0.2/32"],
      })
    ).rejects.toThrow("Invalid peer name");
  });

  it("add_peer with endpoint splits host and port correctly", async () => {
    const tool = findTool(wireguardTools, "openwrt_wireguard_add_peer");
    await tool.handler(client, {
      interface: "wg0",
      peer_name: "client1",
      public_key: "key123",
      allowed_ips: ["10.0.0.2/32"],
      endpoint: "example.com:51820",
    });

    const hostCall = client.calls.find(
      (c) => c.method === "uciSet" && c.args[2] === "endpoint_host"
    );
    const portCall = client.calls.find(
      (c) => c.method === "uciSet" && c.args[2] === "endpoint_port"
    );
    expect(hostCall).toBeDefined();
    expect(hostCall!.args[3]).toBe("example.com");
    expect(portCall).toBeDefined();
    expect(portCall!.args[3]).toBe("51820");
  });

  it("remove_peer validates interface and peer_name", async () => {
    const tool = findTool(wireguardTools, "openwrt_wireguard_remove_peer");
    await expect(
      tool.handler(client, { interface: "../bad", peer_name: "client1" })
    ).rejects.toThrow("Invalid interface name");
  });

  it("remove_peer uses shellQuote for uci delete", async () => {
    const tool = findTool(wireguardTools, "openwrt_wireguard_remove_peer");
    await tool.handler(client, { interface: "wg0", peer_name: "client1" });

    const deleteCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].includes("uci delete")
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall!.args[0]).toBe("uci delete 'network.wg0_client1'");
  });

  it("add_peer rejects hyphenated peer names (invalid UCI section)", async () => {
    const tool = findTool(wireguardTools, "openwrt_wireguard_add_peer");
    await expect(
      tool.handler(client, {
        interface: "wg0",
        peer_name: "my-peer",
        public_key: "key",
        allowed_ips: ["10.0.0.2/32"],
      })
    ).rejects.toThrow("Invalid peer name");
  });

  it("add_peer parses bracketed IPv6 endpoints", async () => {
    const tool = findTool(wireguardTools, "openwrt_wireguard_add_peer");
    await tool.handler(client, {
      interface: "wg0",
      peer_name: "client1",
      public_key: "key123",
      allowed_ips: ["10.0.0.2/32"],
      endpoint: "[2001:db8::1]:51820",
    });

    const hostCall = client.calls.find(
      (c) => c.method === "uciSet" && c.args[2] === "endpoint_host"
    );
    const portCall = client.calls.find(
      (c) => c.method === "uciSet" && c.args[2] === "endpoint_port"
    );
    expect(hostCall!.args[3]).toBe("2001:db8::1");
    expect(portCall!.args[3]).toBe("51820");
  });

  it("add_peer rejects an endpoint without a port and reverts staged changes", async () => {
    const tool = findTool(wireguardTools, "openwrt_wireguard_add_peer");
    await expect(
      tool.handler(client, {
        interface: "wg0",
        peer_name: "client1",
        public_key: "key123",
        allowed_ips: ["10.0.0.2/32"],
        endpoint: "example.com",
      })
    ).rejects.toThrow("Invalid endpoint");
    expect(client.calls.some((c) => c.method === "uciRevert" && c.args[0] === "network")).toBe(true);
  });

  it("show_config redacts private keys and covers non-numeric interface names", async () => {
    (client as any).uciShow = vi.fn(async () => {
      return [
        "network.lan=interface",
        "network.lan.proto='static'",
        "network.wg_vps=interface",
        "network.wg_vps.proto='wireguard'",
        "network.wg_vps.private_key='SUPERSECRET='",
        "network.wg_vps.listen_port='10810'",
      ].join("\n");
    });

    const tool = findTool(wireguardTools, "openwrt_wireguard_show_config");
    const result = await tool.handler(client, {});
    expect(result.success).toBe(true);
    expect(result.configuration).not.toContain("SUPERSECRET");
    expect(result.configuration).toContain("private_key='<redacted>'");
    expect(result.configuration).toContain("network.wg_vps.listen_port='10810'");
    expect(result.configuration).not.toContain("network.lan");
  });
});

describe("DNS tools", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  it("set_upstream_servers uses shellQuote for each server", async () => {
    const tool = findTool(dnsTools, "openwrt_dns_set_upstream_servers");
    await tool.handler(client, { servers: ["8.8.8.8", "1.1.1.1"] });

    const addListCalls = client.calls.filter(
      (c) => c.method === "executeCommand" && c.args[0].includes("uci add_list")
    );
    expect(addListCalls).toHaveLength(2);
    expect(addListCalls[0].args[0]).toContain("'8.8.8.8'");
    expect(addListCalls[1].args[0]).toContain("'1.1.1.1'");
  });

  it("add_static_host validates entry name", async () => {
    const tool = findTool(dnsTools, "openwrt_dns_add_static_host");
    await expect(
      tool.handler(client, { name: "bad;name", hostname: "test.local", ip: "1.2.3.4" })
    ).rejects.toThrow("Invalid entry name");
  });

  it("add_static_host with valid name succeeds", async () => {
    const tool = findTool(dnsTools, "openwrt_dns_add_static_host");
    const result = await tool.handler(client, { name: "myhost", hostname: "test.local", ip: "1.2.3.4" });
    expect(result.success).toBe(true);
  });

  it("add_cname validates entry name", async () => {
    const tool = findTool(dnsTools, "openwrt_dns_add_cname");
    await expect(
      tool.handler(client, { name: "$(cmd)", cname: "www.local", target: "server.local" })
    ).rejects.toThrow("Invalid entry name");
  });

  it("add_static_lease validates entry name", async () => {
    const tool = findTool(dnsTools, "openwrt_dns_add_static_lease");
    await expect(
      tool.handler(client, { name: "../etc", mac: "aa:bb:cc:dd:ee:ff", ip: "1.2.3.4" })
    ).rejects.toThrow("Invalid entry name");
  });

  it("add_static_lease with valid name succeeds", async () => {
    const tool = findTool(dnsTools, "openwrt_dns_add_static_lease");
    const result = await tool.handler(client, { name: "myhost", mac: "aa:bb:cc:dd:ee:ff", ip: "1.2.3.4" });
    expect(result.success).toBe(true);
  });

  it("add_static_lease rejects hyphenated names (invalid UCI section)", async () => {
    const tool = findTool(dnsTools, "openwrt_dns_add_static_lease");
    await expect(
      tool.handler(client, { name: "my-host", mac: "aa:bb:cc:dd:ee:ff", ip: "1.2.3.4" })
    ).rejects.toThrow("Invalid entry name");
  });

  it("set_upstream_servers reverts staged changes on failure", async () => {
    (client as any).executeCommand = vi.fn(async (cmd: string) => {
      client.calls.push({ method: "executeCommand", args: [cmd] });
      if (cmd.includes("uci add_list")) {
        throw new Error("uci: I/O error");
      }
      return "";
    });

    const tool = findTool(dnsTools, "openwrt_dns_set_upstream_servers");
    await expect(tool.handler(client, { servers: ["8.8.8.8"] })).rejects.toThrow("I/O error");
    expect(client.calls.some((c) => c.method === "uciRevert" && c.args[0] === "dhcp")).toBe(true);
    expect(client.calls.some((c) => c.method === "reloadDnsmasq")).toBe(false);
  });
});

describe("Network tools", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  it("get_interface with invalid name throws", async () => {
    const tool = findTool(networkTools, "openwrt_network_get_interface");
    await expect(
      tool.handler(client, { interface: "$(whoami)" })
    ).rejects.toThrow("Invalid interface name");
  });

  it("get_interface with valid name calls ubusCall", async () => {
    const tool = findTool(networkTools, "openwrt_network_get_interface");
    await tool.handler(client, { interface: "lan" });

    const ubusCallEntry = client.calls.find(
      (c) => c.method === "ubusCall" && c.args[0] === "network.interface.lan"
    );
    expect(ubusCallEntry).toBeDefined();
  });

  it("set_static_ip validates interface name", async () => {
    const tool = findTool(networkTools, "openwrt_network_set_static_ip");
    await expect(
      tool.handler(client, { interface: "bad;name", ipaddr: "1.2.3.4", netmask: "255.255.255.0" })
    ).rejects.toThrow("Invalid interface name");
  });

  it("set_static_ip makes correct uciSet calls", async () => {
    const tool = findTool(networkTools, "openwrt_network_set_static_ip");
    await tool.handler(client, {
      interface: "lan",
      ipaddr: "192.168.1.1",
      netmask: "255.255.255.0",
      gateway: "192.168.1.254",
    });

    const uciCalls = client.calls.filter((c) => c.method === "uciSet");
    expect(uciCalls.some((c) => c.args[2] === "proto" && c.args[3] === "static")).toBe(true);
    expect(uciCalls.some((c) => c.args[2] === "ipaddr" && c.args[3] === "192.168.1.1")).toBe(true);
    expect(uciCalls.some((c) => c.args[2] === "netmask" && c.args[3] === "255.255.255.0")).toBe(true);
    expect(uciCalls.some((c) => c.args[2] === "gateway" && c.args[3] === "192.168.1.254")).toBe(true);
  });

  it("add_static_route validates route name", async () => {
    const tool = findTool(networkTools, "openwrt_network_add_static_route");
    await expect(
      tool.handler(client, { name: "bad route", target: "10.0.0.0/24", gateway: "1.2.3.4" })
    ).rejects.toThrow("Invalid route name");
  });

  it("set_dhcp validates interface name", async () => {
    const tool = findTool(networkTools, "openwrt_network_set_dhcp");
    await expect(
      tool.handler(client, { interface: "a b" })
    ).rejects.toThrow("Invalid interface name");
  });
});

describe("Script tools", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  it("script_create uses shellQuote for chmod", async () => {
    const tool = findTool(scriptTools, "openwrt_script_create");
    await tool.handler(client, { name: "test.sh", content: "echo hi" });

    const chmodCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].includes("chmod")
    );
    expect(chmodCall).toBeDefined();
    expect(chmodCall!.args[0]).toBe("chmod +x '/root/test.sh'");
  });

  it("script_execute quotes the path but not args", async () => {
    const tool = findTool(scriptTools, "openwrt_script_execute");
    await tool.handler(client, { path: "/root/test.sh", args: "-v --flag" });

    const execCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].includes("test.sh")
    );
    expect(execCall).toBeDefined();
    expect(execCall!.args[0]).toBe("'/root/test.sh' -v --flag");
  });

  it("script_execute background uses nohup with output redirect", async () => {
    const tool = findTool(scriptTools, "openwrt_script_execute");
    await tool.handler(client, { path: "/root/test.sh", background: true });

    const execCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].includes("test.sh")
    );
    expect(execCall).toBeDefined();
    expect(execCall!.args[0]).toBe("nohup '/root/test.sh' >/dev/null 2>&1 &");
  });

  it("script_list uses find instead of ls glob", async () => {
    const tool = findTool(scriptTools, "openwrt_script_list");
    await tool.handler(client, { directory: "/root", pattern: "*.sh" });

    const findCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].includes("find")
    );
    expect(findCall).toBeDefined();
    expect(findCall!.args[0]).toContain("find '/root'");
  });
});
