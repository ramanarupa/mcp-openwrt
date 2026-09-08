import { OpenWRTClient } from "../openwrt-client.js";
import { Tool } from "../types.js";
import { shellQuote, validateUciSectionName, extractWireguardConfig, validateWgKey } from "../utils.js";

/**
 * Derive the public key without putting the private key on a command line
 * (it would be visible in `ps` on the router): feed it to `wg pubkey` via stdin.
 */
async function derivePublicKey(client: OpenWRTClient, privateKey: string): Promise<string> {
  return (await client.executeCommand("wg pubkey", { stdin: privateKey + "\n" })).trim();
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

      validateUciSectionName(name, "interface name");

      // Generate private key if not provided
      const privateKey = validateWgKey(
        private_key ? private_key : (await client.executeCommand("wg genkey")).trim(),
        "private_key"
      );

      try {
        // Create interface section
        await client.uciAddSection("network", name, "interface");
        await client.uciSet("network", name, "proto", "wireguard");
        // Secret: goes through `uci batch` stdin, never the command line
        await client.uciSetSecret("network", name, "private_key", privateKey);
        await client.uciSet("network", name, "listen_port", listen_port.toString());

        // Add IP addresses
        for (const addr of addresses) {
          await client.executeCommand(`uci add_list network.${name}.addresses=${shellQuote(addr)}`);
        }

        // Commit and reload
        await client.uciCommit("network");
      } catch (error) {
        await client.uciRevert("network");
        throw error;
      }

      await client.reloadNetwork();

      // Get public key
      const publicKey = await derivePublicKey(client, privateKey);

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

      validateUciSectionName(iface, "interface name");
      validateUciSectionName(peer_name, "peer name");
      validateWgKey(public_key, "public_key");
      if (preshared_key) validateWgKey(preshared_key, "preshared_key");

      // Create peer section
      const peerSection = `${iface}_${peer_name}`;
      try {
        await client.uciAddSection("network", peerSection, "wireguard_" + iface);
        await client.uciSet("network", peerSection, "public_key", public_key);

        // Add allowed IPs
        for (const ip of allowed_ips) {
          await client.executeCommand(`uci add_list network.${peerSection}.allowed_ips=${shellQuote(ip)}`);
        }

        // Optional parameters
        if (endpoint) {
          // Supports host:port, v4:port and [v6]:port (brackets stripped for UCI)
          const match =
            endpoint.match(/^\[([^\]]+)\]:(\d+)$/) || endpoint.match(/^(.+):(\d+)$/);
          if (!match) {
            throw new Error(
              `Invalid endpoint: ${JSON.stringify(endpoint)}. Expected "host:port" or "[ipv6]:port".`
            );
          }
          await client.uciSet("network", peerSection, "endpoint_host", match[1]);
          await client.uciSet("network", peerSection, "endpoint_port", match[2]);
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
          // Secret: goes through `uci batch` stdin, never the command line
          await client.uciSetSecret("network", peerSection, "preshared_key", preshared_key);
        }

        // Commit and reload
        await client.uciCommit("network");
      } catch (error) {
        await client.uciRevert("network");
        throw error;
      }

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

      validateUciSectionName(iface, "interface name");
      validateUciSectionName(peer_name, "peer name");

      const peerSection = `${iface}_${peer_name}`;

      // Delete peer section (peerSection is built from validateUciSectionName-checked parts)
      await client.executeCommand(`uci delete ${shellQuote(`network.${peerSection}`)}`);

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
      const privateKey = validateWgKey((await client.executeCommand("wg genkey")).trim(), "generated key");
      const publicKey = await derivePublicKey(client, privateKey);

      return {
        success: true,
        private_key: privateKey,
        public_key: publicKey,
      };
    },
  },
  {
    name: "openwrt_wireguard_show_config",
    description: "Show the current WireGuard configuration from UCI (private/preshared keys are redacted)",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (client: OpenWRTClient) => {
      try {
        const config = await client.uciShow("network");
        // Sections with proto='wireguard' plus their peers, keys redacted
        const filtered = extractWireguardConfig(config);
        return {
          success: true,
          configuration: filtered || "No WireGuard configuration found",
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
