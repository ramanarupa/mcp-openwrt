import { OpenWRTClient } from "./openwrt-client.js";

export interface Resource {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
  handler: (client: OpenWRTClient) => Promise<string>;
}

export const resources: Resource[] = [
  {
    uri: "openwrt://config/network",
    name: "Network Configuration",
    description: "Complete network configuration from /etc/config/network",
    mimeType: "text/plain",
    handler: async (client: OpenWRTClient) => {
      return await client.readFile("/etc/config/network");
    },
  },
  {
    uri: "openwrt://config/wireless",
    name: "Wireless Configuration",
    description: "WiFi configuration from /etc/config/wireless",
    mimeType: "text/plain",
    handler: async (client: OpenWRTClient) => {
      return await client.readFile("/etc/config/wireless");
    },
  },
  {
    uri: "openwrt://config/dhcp",
    name: "DHCP Configuration",
    description: "DHCP and DNS configuration from /etc/config/dhcp",
    mimeType: "text/plain",
    handler: async (client: OpenWRTClient) => {
      return await client.readFile("/etc/config/dhcp");
    },
  },
  {
    uri: "openwrt://config/firewall",
    name: "Firewall Configuration",
    description: "Firewall rules from /etc/config/firewall",
    mimeType: "text/plain",
    handler: async (client: OpenWRTClient) => {
      return await client.readFile("/etc/config/firewall");
    },
  },
  {
    uri: "openwrt://config/system",
    name: "System Configuration",
    description: "System settings from /etc/config/system",
    mimeType: "text/plain",
    handler: async (client: OpenWRTClient) => {
      return await client.readFile("/etc/config/system");
    },
  },
  {
    uri: "openwrt://config/wireguard",
    name: "WireGuard Configuration",
    description: "WireGuard VPN configuration",
    mimeType: "text/plain",
    handler: async (client: OpenWRTClient) => {
      try {
        // Try to read network config and filter WireGuard interfaces
        const networkConfig = await client.readFile("/etc/config/network");
        return networkConfig;
      } catch (error) {
        return "WireGuard configuration not found or not configured";
      }
    },
  },
  {
    uri: "openwrt://status/system",
    name: "System Status",
    description: "Current system status including uptime, load, memory",
    mimeType: "application/json",
    handler: async (client: OpenWRTClient) => {
      const result = await client.ubusCall("system", "info");
      return JSON.stringify(result, null, 2);
    },
  },
  {
    uri: "openwrt://status/network",
    name: "Network Status",
    description: "Current status of all network interfaces",
    mimeType: "application/json",
    handler: async (client: OpenWRTClient) => {
      const result = await client.ubusCall("network.interface", "dump");
      return JSON.stringify(result, null, 2);
    },
  },
  {
    uri: "openwrt://logs/system",
    name: "System Logs",
    description: "Recent system log entries",
    mimeType: "text/plain",
    handler: async (client: OpenWRTClient) => {
      return await client.executeCommand("logread | tail -100");
    },
  },
  {
    uri: "openwrt://logs/kernel",
    name: "Kernel Logs",
    description: "Recent kernel log entries (dmesg)",
    mimeType: "text/plain",
    handler: async (client: OpenWRTClient) => {
      return await client.executeCommand("dmesg | tail -100");
    },
  },
];
