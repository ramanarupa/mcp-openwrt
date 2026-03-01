import { OpenWRTClient } from "../openwrt-client.js";
import { Tool } from "../types.js";
import { validateName } from "../utils.js";

export const networkTools: Tool[] = [
  {
    name: "openwrt_network_list_interfaces",
    description: "List all network interfaces on the OpenWRT device",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (client: OpenWRTClient) => {
      const result = await client.ubusCall("network.interface", "dump");
      return {
        success: true,
        interfaces: result.interface || [],
      };
    },
  },
  {
    name: "openwrt_network_get_interface",
    description: "Get detailed information about a specific network interface",
    inputSchema: {
      type: "object",
      properties: {
        interface: {
          type: "string",
          description: "Interface name (e.g., 'lan', 'wan', 'wan6')",
        },
      },
      required: ["interface"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      validateName(args.interface, "interface name");
      const result = await client.ubusCall("network.interface." + args.interface, "status");
      return {
        success: true,
        interface: args.interface,
        status: result,
      };
    },
  },
  {
    name: "openwrt_network_set_static_ip",
    description: "Set a static IP address for a network interface",
    inputSchema: {
      type: "object",
      properties: {
        interface: {
          type: "string",
          description: "Interface name (e.g., 'lan', 'wan')",
        },
        ipaddr: {
          type: "string",
          description: "IP address (e.g., '192.168.1.1')",
        },
        netmask: {
          type: "string",
          description: "Network mask (e.g., '255.255.255.0')",
        },
        gateway: {
          type: "string",
          description: "Gateway address (optional, usually for WAN)",
        },
      },
      required: ["interface", "ipaddr", "netmask"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { interface: iface, ipaddr, netmask, gateway } = args;

      validateName(iface, "interface name");

      // Set protocol to static
      await client.uciSet("network", iface, "proto", "static");

      // Set IP address
      await client.uciSet("network", iface, "ipaddr", ipaddr);

      // Set netmask
      await client.uciSet("network", iface, "netmask", netmask);

      // Set gateway if provided
      if (gateway) {
        await client.uciSet("network", iface, "gateway", gateway);
      }

      // Commit changes
      await client.uciCommit("network");

      // Reload network
      await client.reloadNetwork();

      return {
        success: true,
        message: `Static IP configured for interface ${iface}`,
        configuration: { ipaddr, netmask, gateway },
      };
    },
  },
  {
    name: "openwrt_network_set_dhcp",
    description: "Set a network interface to use DHCP",
    inputSchema: {
      type: "object",
      properties: {
        interface: {
          type: "string",
          description: "Interface name (e.g., 'wan')",
        },
      },
      required: ["interface"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { interface: iface } = args;

      validateName(iface, "interface name");

      // Set protocol to DHCP
      await client.uciSet("network", iface, "proto", "dhcp");

      // Commit changes
      await client.uciCommit("network");

      // Reload network
      await client.reloadNetwork();

      return {
        success: true,
        message: `DHCP enabled for interface ${iface}`,
      };
    },
  },
  {
    name: "openwrt_network_show_config",
    description: "Show the current network configuration",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (client: OpenWRTClient) => {
      const config = await client.uciShow("network");
      return {
        success: true,
        configuration: config,
      };
    },
  },
  {
    name: "openwrt_network_add_static_route",
    description: "Add a static route to the routing table",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Route name/identifier",
        },
        target: {
          type: "string",
          description: "Target network (e.g., '10.0.0.0/24')",
        },
        gateway: {
          type: "string",
          description: "Gateway IP address",
        },
        interface: {
          type: "string",
          description: "Interface name (optional)",
        },
      },
      required: ["name", "target", "gateway"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { name, target, gateway, interface: iface } = args;

      validateName(name, "route name");

      // Create new route section
      await client.uciAddSection("network", name, "route");
      await client.uciSet("network", name, "target", target);
      await client.uciSet("network", name, "gateway", gateway);

      if (iface) {
        await client.uciSet("network", name, "interface", iface);
      }

      // Commit and reload
      await client.uciCommit("network");
      await client.reloadNetwork();

      return {
        success: true,
        message: `Static route ${name} added`,
        route: { target, gateway, interface: iface },
      };
    },
  },
];
