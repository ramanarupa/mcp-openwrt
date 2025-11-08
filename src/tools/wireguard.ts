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

export const wireguardTools: Tool[] = [
  {
    name: "openwrt_wireguard_show_interfaces",
    description: "List all WireGuard interfaces and their configurations",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (client: OpenWRTClient) => {
      try {
        // Get network config and parse WireGuard interfaces
        const output = await client.executeCommand("wg show all");
        return {
          success: true,
          output,
        };
      } catch (error) {
        return {
          success: false,
          message: "WireGuard not installed or no interfaces configured",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
  {
    name: "openwrt_wireguard_create_interface",
    description: "Create a new WireGuard interface",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Interface name (e.g., 'wg0')",
        },
        private_key: {
          type: "string",
          description: "Private key for the interface (optional, will generate if not provided)",
        },
        listen_port: {
          type: "number",
          description: "UDP listen port (e.g., 51820)",
        },
        addresses: {
          type: "array",
          description: "IP addresses for the interface (e.g., ['10.0.0.1/24'])",
          items: {
            type: "string",
          },
        },
      },
      required: ["name", "listen_port", "addresses"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { name, private_key, listen_port, addresses } = args;

      // Generate private key if not provided
      let privateKey = private_key;
      if (!privateKey) {
        privateKey = (await client.executeCommand("wg genkey")).trim();
      }

      // Create interface section
      await client.uciAddSection("network", name, "interface");
      await client.uciSet("network", name, "proto", "wireguard");
      await client.uciSet("network", name, "private_key", privateKey);
      await client.uciSet("network", name, "listen_port", listen_port.toString());

      // Add IP addresses
      for (const addr of addresses) {
        const command = `uci add_list network.${name}.addresses='${addr}'`;
        await client.executeCommand(command);
      }

      // Commit and reload
      await client.uciCommit("network");
      await client.reloadNetwork();

      // Get public key
      const publicKey = (
        await client.executeCommand(`echo "${privateKey}" | wg pubkey`)
      ).trim();

      return {
        success: true,
        message: `WireGuard interface ${name} created`,
        interface: name,
        public_key: publicKey,
        listen_port,
        addresses,
      };
    },
  },
  {
    name: "openwrt_wireguard_add_peer",
    description: "Add a peer to a WireGuard interface",
    inputSchema: {
      type: "object",
      properties: {
        interface: {
          type: "string",
          description: "WireGuard interface name (e.g., 'wg0')",
        },
        peer_name: {
          type: "string",
          description: "Unique name for the peer (for UCI config)",
        },
        public_key: {
          type: "string",
          description: "Public key of the peer",
        },
        allowed_ips: {
          type: "array",
          description: "Allowed IP addresses for the peer (e.g., ['10.0.0.2/32'])",
          items: {
            type: "string",
          },
        },
        endpoint: {
          type: "string",
          description: "Peer endpoint address:port (optional, for client-to-server)",
        },
        persistent_keepalive: {
          type: "number",
          description: "Keepalive interval in seconds (optional, usually 25)",
        },
        preshared_key: {
          type: "string",
          description: "Preshared key for additional security (optional)",
        },
      },
      required: ["interface", "peer_name", "public_key", "allowed_ips"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const {
        interface: iface,
        peer_name,
        public_key,
        allowed_ips,
        endpoint,
        persistent_keepalive,
        preshared_key,
      } = args;

      // Create peer section
      const peerSection = `${iface}_${peer_name}`;
      await client.uciAddSection("network", peerSection, "wireguard_" + iface);
      await client.uciSet("network", peerSection, "public_key", public_key);

      // Add allowed IPs
      for (const ip of allowed_ips) {
        const command = `uci add_list network.${peerSection}.allowed_ips='${ip}'`;
        await client.executeCommand(command);
      }

      // Optional parameters
      if (endpoint) {
        await client.uciSet("network", peerSection, "endpoint_host", endpoint.split(":")[0]);
        await client.uciSet("network", peerSection, "endpoint_port", endpoint.split(":")[1]);
      }

      if (persistent_keepalive) {
        await client.uciSet(
          "network",
          peerSection,
          "persistent_keepalive",
          persistent_keepalive.toString()
        );
      }

      if (preshared_key) {
        await client.uciSet("network", peerSection, "preshared_key", preshared_key);
      }

      // Commit and reload
      await client.uciCommit("network");
      await client.reloadNetwork();

      return {
        success: true,
        message: `Peer ${peer_name} added to ${iface}`,
        peer: {
          name: peer_name,
          public_key,
          allowed_ips,
          endpoint,
          persistent_keepalive,
        },
      };
    },
  },
  {
    name: "openwrt_wireguard_remove_peer",
    description: "Remove a peer from a WireGuard interface",
    inputSchema: {
      type: "object",
      properties: {
        interface: {
          type: "string",
          description: "WireGuard interface name",
        },
        peer_name: {
          type: "string",
          description: "Name of the peer to remove",
        },
      },
      required: ["interface", "peer_name"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { interface: iface, peer_name } = args;
      const peerSection = `${iface}_${peer_name}`;

      // Delete peer section
      await client.executeCommand(`uci delete network.${peerSection}`);

      // Commit and reload
      await client.uciCommit("network");
      await client.reloadNetwork();

      return {
        success: true,
        message: `Peer ${peer_name} removed from ${iface}`,
      };
    },
  },
  {
    name: "openwrt_wireguard_generate_keypair",
    description: "Generate a new WireGuard key pair (private and public keys)",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (client: OpenWRTClient) => {
      const privateKey = (await client.executeCommand("wg genkey")).trim();
      const publicKey = (
        await client.executeCommand(`echo "${privateKey}" | wg pubkey`)
      ).trim();

      return {
        success: true,
        private_key: privateKey,
        public_key: publicKey,
      };
    },
  },
  {
    name: "openwrt_wireguard_show_config",
    description: "Show the current WireGuard configuration from UCI",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (client: OpenWRTClient) => {
      try {
        const config = await client.uciShow("network");
        // Filter only WireGuard-related configuration
        const lines = config.split("\n").filter((line) => line.includes("wireguard"));
        return {
          success: true,
          configuration: lines.join("\n"),
        };
      } catch (error) {
        return {
          success: false,
          message: "No WireGuard configuration found",
        };
      }
    },
  },
];
