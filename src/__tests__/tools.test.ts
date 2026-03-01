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
    executeCommand: vi.fn(async (cmd: string) => {
      calls.push({ method: "executeCommand", args: [cmd] });
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
      (c) => c.method === "executeCommand" && c.args[0].includes("opkg install")
    );
    expect(installCall).toBeDefined();
    expect(installCall!.args[0]).toBe("opkg install 'luci-app-test'");
  });

  it("package_remove uses shellQuote", async () => {
    const tool = findTool(systemTools, "openwrt_package_remove");
    await tool.handler(client, { package: "test-pkg" });

    const removeCall = client.calls.find(
      (c) => c.method === "executeCommand" && c.args[0].includes("opkg remove")
    );
    expect(removeCall).toBeDefined();
    expect(removeCall!.args[0]).toBe("opkg remove 'test-pkg'");
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
