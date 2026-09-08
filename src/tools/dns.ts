import { OpenWRTClient } from "../openwrt-client.js";
import { Tool } from "../types.js";
import { shellQuote, validateUciSectionName } from "../utils.js";

/**
 * Create a section in `config`: named when `name` is given (validated as a
 * UCI identifier), otherwise anonymous via `uci add`, which sidesteps the
 * "hostname with a hyphen is not a valid section name" trap. Returns the
 * section id to use for subsequent `uci set` calls.
 */
async function createDhcpSection(client: OpenWRTClient, type: string, name?: string): Promise<string> {
  if (name) {
    await client.uciAddSection("dhcp", name, type);
    return name;
  }
  return client.uciAddAnonymousSection("dhcp", type);
}

const NAME_DESCRIPTION =
  "UCI section name (optional; letters, digits, underscores only). Omit to create an anonymous section — required when the natural name contains hyphens or dots.";

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

      try {
        // Delete existing DNS server list
        try {
          await client.executeCommand("uci delete dhcp.@dnsmasq[0].server");
        } catch (error) {
          // Ignore if list doesn't exist yet
        }

        // Add new DNS servers via list
        for (const server of servers) {
          await client.executeCommand(`uci add_list dhcp.@dnsmasq[0].server=${shellQuote(server)}`);
        }

        await client.uciCommit("dhcp");
      } catch (error) {
        // Don't leave staged changes behind — they'd be silently picked up
        // by the next `uci commit dhcp` from an unrelated tool call
        await client.uciRevert("dhcp");
        throw error;
      }

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
          description: NAME_DESCRIPTION,
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
      required: ["hostname", "ip"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { name, hostname, ip } = args;

      if (name) validateUciSectionName(name, "entry name");

      let section: string;
      try {
        // Create new domain section
        section = await createDhcpSection(client, "domain", name);
        await client.uciSet("dhcp", section, "name", hostname);
        await client.uciSet("dhcp", section, "ip", ip);

        // Commit and reload
        await client.uciCommit("dhcp");
      } catch (error) {
        await client.uciRevert("dhcp");
        throw error;
      }

      await client.reloadDnsmasq();

      return {
        success: true,
        message: `Static DNS entry added: ${hostname} -> ${ip}`,
        section,
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
          description: NAME_DESCRIPTION,
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
      required: ["cname", "target"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { name, cname, target } = args;

      if (name) validateUciSectionName(name, "entry name");

      let section: string;
      try {
        // Create new cname section
        section = await createDhcpSection(client, "cname", name);
        await client.uciSet("dhcp", section, "cname", cname);
        await client.uciSet("dhcp", section, "target", target);

        // Commit and reload
        await client.uciCommit("dhcp");
      } catch (error) {
        await client.uciRevert("dhcp");
        throw error;
      }

      await client.reloadDnsmasq();

      return {
        success: true,
        message: `CNAME record added: ${cname} -> ${target}`,
        section,
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

      validateUciSectionName(iface, "interface name");

      try {
        // The dhcp.<iface> section may not exist yet (uci set on a missing
        // section fails with "Invalid argument"); create it idempotently
        await client.uciAddSection("dhcp", iface, "dhcp", { allowExisting: true });
        // Configure DHCP pool
        await client.uciSet("dhcp", iface, "interface", iface);
        await client.uciSet("dhcp", iface, "start", start.toString());
        await client.uciSet("dhcp", iface, "limit", limit.toString());
        await client.uciSet("dhcp", iface, "leasetime", leasetime);

        // Commit and reload
        await client.uciCommit("dhcp");
      } catch (error) {
        await client.uciRevert("dhcp");
        throw error;
      }

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
          description: NAME_DESCRIPTION,
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
      required: ["mac", "ip"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { name, mac, ip, hostname } = args;

      if (name) validateUciSectionName(name, "entry name");

      let section: string;
      try {
        // Create new host section
        section = await createDhcpSection(client, "host", name);
        await client.uciSet("dhcp", section, "mac", mac);
        await client.uciSet("dhcp", section, "ip", ip);

        if (hostname) {
          await client.uciSet("dhcp", section, "name", hostname);
        }

        // Commit and reload
        await client.uciCommit("dhcp");
      } catch (error) {
        await client.uciRevert("dhcp");
        throw error;
      }

      await client.reloadDnsmasq();

      return {
        success: true,
        message: `Static DHCP lease added: ${mac} -> ${ip}`,
        section,
        entry: { mac, ip, hostname },
      };
    },
  },
];
