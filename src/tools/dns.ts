import { OpenWRTClient } from "../openwrt-client.js";

export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (client: OpenWRTClient, args: Record<string, any>) => Promise<any>;
}

export const dnsTools: Tool[] = [
  {
    name: "openwrt_dns_show_config",
    description: "Show the current DNS and DHCP configuration",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (client: OpenWRTClient) => {
      const config = await client.uciShow("dhcp");
      return {
        success: true,
        configuration: config,
      };
    },
  },
  {
    name: "openwrt_dns_set_upstream_servers",
    description: "Set upstream DNS servers for the OpenWRT device",
    inputSchema: {
      type: "object",
      properties: {
        servers: {
          type: "array",
          description: "Array of DNS server IPs (e.g., ['8.8.8.8', '1.1.1.1'])",
          items: {
            type: "string",
          },
        },
      },
      required: ["servers"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const servers = args.servers as string[];

      // Delete existing DNS servers
      try {
        await client.uciSet("dhcp", "dnsmasq", "server", "");
      } catch (error) {
        // Ignore if doesn't exist
      }

      // Add new DNS servers
      for (const server of servers) {
        const command = `uci add_list dhcp.@dnsmasq[0].server='${server}'`;
        await client.uciAddSection("dhcp", "@dnsmasq[0]", "dnsmasq");
      }

      // Commit and reload
      await client.uciCommit("dhcp");
      await client.reloadDnsmasq();

      return {
        success: true,
        message: "Upstream DNS servers configured",
        servers,
      };
    },
  },
  {
    name: "openwrt_dns_add_static_host",
    description: "Add a static DNS host entry (A record)",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Entry name/identifier for UCI configuration",
        },
        hostname: {
          type: "string",
          description: "Hostname to resolve (e.g., 'myserver.local')",
        },
        ip: {
          type: "string",
          description: "IP address for the hostname",
        },
      },
      required: ["name", "hostname", "ip"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { name, hostname, ip } = args;

      // Create new domain section
      await client.uciAddSection("dhcp", name, "domain");
      await client.uciSet("dhcp", name, "name", hostname);
      await client.uciSet("dhcp", name, "ip", ip);

      // Commit and reload
      await client.uciCommit("dhcp");
      await client.reloadDnsmasq();

      return {
        success: true,
        message: `Static DNS entry added: ${hostname} -> ${ip}`,
        entry: { hostname, ip },
      };
    },
  },
  {
    name: "openwrt_dns_add_cname",
    description: "Add a DNS CNAME record",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Entry name/identifier for UCI configuration",
        },
        cname: {
          type: "string",
          description: "CNAME alias (e.g., 'www.local')",
        },
        target: {
          type: "string",
          description: "Target hostname (e.g., 'server.local')",
        },
      },
      required: ["name", "cname", "target"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { name, cname, target } = args;

      // Create new cname section
      await client.uciAddSection("dhcp", name, "cname");
      await client.uciSet("dhcp", name, "cname", cname);
      await client.uciSet("dhcp", name, "target", target);

      // Commit and reload
      await client.uciCommit("dhcp");
      await client.reloadDnsmasq();

      return {
        success: true,
        message: `CNAME record added: ${cname} -> ${target}`,
        entry: { cname, target },
      };
    },
  },
  {
    name: "openwrt_dns_set_dhcp_range",
    description: "Configure DHCP range for a network interface",
    inputSchema: {
      type: "object",
      properties: {
        interface: {
          type: "string",
          description: "Interface name (e.g., 'lan')",
        },
        start: {
          type: "number",
          description: "Start of DHCP range (e.g., 100 for .100)",
        },
        limit: {
          type: "number",
          description: "Number of addresses in pool (e.g., 150)",
        },
        leasetime: {
          type: "string",
          description: "Lease time (e.g., '12h', '7d')",
        },
      },
      required: ["interface", "start", "limit", "leasetime"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { interface: iface, start, limit, leasetime } = args;

      // Configure DHCP pool
      await client.uciSet("dhcp", iface, "interface", iface);
      await client.uciSet("dhcp", iface, "start", start.toString());
      await client.uciSet("dhcp", iface, "limit", limit.toString());
      await client.uciSet("dhcp", iface, "leasetime", leasetime);

      // Commit and reload
      await client.uciCommit("dhcp");
      await client.reloadDnsmasq();

      return {
        success: true,
        message: `DHCP range configured for ${iface}`,
        configuration: { start, limit, leasetime },
      };
    },
  },
  {
    name: "openwrt_dns_add_static_lease",
    description: "Add a static DHCP lease (MAC to IP binding)",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Entry name/identifier",
        },
        mac: {
          type: "string",
          description: "MAC address (e.g., 'aa:bb:cc:dd:ee:ff')",
        },
        ip: {
          type: "string",
          description: "IP address to assign",
        },
        hostname: {
          type: "string",
          description: "Hostname (optional)",
        },
      },
      required: ["name", "mac", "ip"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { name, mac, ip, hostname } = args;

      // Create new host section
      await client.uciAddSection("dhcp", name, "host");
      await client.uciSet("dhcp", name, "mac", mac);
      await client.uciSet("dhcp", name, "ip", ip);

      if (hostname) {
        await client.uciSet("dhcp", name, "name", hostname);
      }

      // Commit and reload
      await client.uciCommit("dhcp");
      await client.reloadDnsmasq();

      return {
        success: true,
        message: `Static DHCP lease added: ${mac} -> ${ip}`,
        entry: { mac, ip, hostname },
      };
    },
  },
];
