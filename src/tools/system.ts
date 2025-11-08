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

export const systemTools: Tool[] = [
  {
    name: "openwrt_system_info",
    description: "Get system information (uptime, load, memory, etc.)",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (client: OpenWRTClient) => {
      const result = await client.ubusCall("system", "info");
      return {
        success: true,
        system: result,
      };
    },
  },
  {
    name: "openwrt_system_board_info",
    description: "Get board/hardware information",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (client: OpenWRTClient) => {
      const result = await client.ubusCall("system", "board");
      return {
        success: true,
        board: result,
      };
    },
  },
  {
    name: "openwrt_system_execute_command",
    description: "Execute a shell command on the OpenWRT device (use with caution)",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute",
        },
      },
      required: ["command"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { command } = args;

      try {
        const output = await client.executeCommand(command);
        return {
          success: true,
          output,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
  {
    name: "openwrt_system_list_processes",
    description: "List running processes",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (client: OpenWRTClient) => {
      const output = await client.executeCommand("ps w");
      return {
        success: true,
        processes: output,
      };
    },
  },
  {
    name: "openwrt_system_disk_usage",
    description: "Show disk usage statistics",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (client: OpenWRTClient) => {
      const output = await client.executeCommand("df -h");
      return {
        success: true,
        disk_usage: output,
      };
    },
  },
  {
    name: "openwrt_package_list_installed",
    description: "List installed packages",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          description: "Filter packages by name (optional)",
        },
      },
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { filter } = args;
      const command = filter
        ? `opkg list-installed | grep ${filter}`
        : "opkg list-installed";

      const output = await client.executeCommand(command);
      return {
        success: true,
        packages: output,
      };
    },
  },
  {
    name: "openwrt_package_install",
    description: "Install a package using opkg",
    inputSchema: {
      type: "object",
      properties: {
        package: {
          type: "string",
          description: "Package name to install",
        },
      },
      required: ["package"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { package: pkg } = args;

      try {
        // Update package list first
        await client.executeCommand("opkg update");

        // Install package
        const output = await client.executeCommand(`opkg install ${pkg}`);

        return {
          success: true,
          message: `Package ${pkg} installed successfully`,
          output,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to install package ${pkg}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
  {
    name: "openwrt_package_remove",
    description: "Remove a package using opkg",
    inputSchema: {
      type: "object",
      properties: {
        package: {
          type: "string",
          description: "Package name to remove",
        },
      },
      required: ["package"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { package: pkg } = args;

      try {
        const output = await client.executeCommand(`opkg remove ${pkg}`);

        return {
          success: true,
          message: `Package ${pkg} removed successfully`,
          output,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to remove package ${pkg}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
  {
    name: "openwrt_service_list",
    description: "List all available services",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (client: OpenWRTClient) => {
      const output = await client.executeCommand("ls /etc/init.d/");
      return {
        success: true,
        services: output.split("\n").filter((s) => s.length > 0),
      };
    },
  },
  {
    name: "openwrt_service_control",
    description: "Control a service (start, stop, restart, enable, disable)",
    inputSchema: {
      type: "object",
      properties: {
        service: {
          type: "string",
          description: "Service name (e.g., 'network', 'dnsmasq', 'firewall')",
        },
        action: {
          type: "string",
          enum: ["start", "stop", "restart", "reload", "enable", "disable", "status"],
          description: "Action to perform",
        },
      },
      required: ["service", "action"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { service, action } = args;

      try {
        const output = await client.executeCommand(`/etc/init.d/${service} ${action}`);
        return {
          success: true,
          message: `Service ${service} ${action} executed`,
          output,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to ${action} service ${service}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
  {
    name: "openwrt_system_reboot",
    description: "Reboot the OpenWRT device",
    inputSchema: {
      type: "object",
      properties: {
        confirm: {
          type: "boolean",
          description: "Must be set to true to confirm reboot",
        },
      },
      required: ["confirm"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { confirm } = args;

      if (!confirm) {
        return {
          success: false,
          message: "Reboot not confirmed. Set confirm to true to proceed.",
        };
      }

      try {
        await client.executeCommand("reboot");
        return {
          success: true,
          message: "Reboot command sent. Device will restart shortly.",
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
  {
    name: "openwrt_system_backup_config",
    description: "Create a backup of the current configuration",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (client: OpenWRTClient) => {
      try {
        // Generate backup archive
        const output = await client.executeCommand("sysupgrade -b /tmp/backup.tar.gz && cat /tmp/backup.tar.gz | base64");

        return {
          success: true,
          message: "Configuration backup created",
          backup_data: output,
          note: "Backup is base64 encoded. Decode and save as .tar.gz file",
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
];
