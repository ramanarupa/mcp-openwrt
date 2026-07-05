import { OpenWRTClient } from "../openwrt-client.js";
import { Tool } from "../types.js";
import { shellQuote, validateName } from "../utils.js";

const VALID_SERVICE_ACTIONS = ["start", "stop", "restart", "reload", "enable", "disable", "status"] as const;

// apk over a slow uplink can easily exceed the default 30s command timeout
const PACKAGE_TIMEOUT = 120_000;

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
    description: "Execute a shell command on the OpenWRT device. WARNING: This runs arbitrary commands — use with caution. Set confirm to true to proceed.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute",
        },
        confirm: {
          type: "boolean",
          description: "Must be set to true to confirm execution",
        },
      },
      required: ["command", "confirm"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { command, confirm } = args;

      if (!confirm) {
        return {
          success: false,
          message: "Execution not confirmed. Set confirm to true to proceed.",
        };
      }

      const output = await client.executeCommand(command);
      return {
        success: true,
        output,
      };
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
        ? `apk list --installed | grep -F -- ${shellQuote(filter)}`
        : "apk list --installed";

      try {
        const output = await client.executeCommand(command);
        return {
          success: true,
          packages: output,
        };
      } catch (error) {
        // grep exits with code 1 when the filter matches nothing — not an error
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (filter && errorMsg.includes("code 1")) {
          return {
            success: true,
            packages: "",
            message: "No installed packages match the filter",
          };
        }
        throw error;
      }
    },
  },
  {
    name: "openwrt_package_install",
    description: "Install a package using apk",
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

      // Update package list first
      await client.executeCommand("apk update", { timeout: PACKAGE_TIMEOUT });

      // Install package
      const output = await client.executeCommand(`apk add ${shellQuote(pkg)}`, { timeout: PACKAGE_TIMEOUT });

      return {
        success: true,
        message: `Package ${pkg} installed successfully`,
        output,
      };
    },
  },
  {
    name: "openwrt_package_remove",
    description: "Remove a package using apk",
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
      const output = await client.executeCommand(`apk del ${shellQuote(pkg)}`, { timeout: PACKAGE_TIMEOUT });

      return {
        success: true,
        message: `Package ${pkg} removed successfully`,
        output,
      };
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

      validateName(service, "service name");
      if (!VALID_SERVICE_ACTIONS.includes(action)) {
        throw new Error(`Invalid action: ${JSON.stringify(action)}. Must be one of: ${VALID_SERVICE_ACTIONS.join(", ")}`);
      }

      // `status` exits non-zero (e.g. 3) for stopped procd services — that's a
      // report, not a failure. Merge stderr and mask the exit code for it.
      const command = action === "status"
        ? `/etc/init.d/${service} status 2>&1 || true`
        : `/etc/init.d/${service} ${action}`;
      const output = await client.executeCommand(command);
      return {
        success: true,
        message: `Service ${service} ${action} executed`,
        output,
      };
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

      // Ensure we are actually connected before sending — a connect failure
      // must propagate (device unreachable ≠ reboot succeeded)
      await client.connect();
      try {
        await client.executeCommand("reboot");
      } catch (error) {
        // The SSH channel drops as the device goes down — that's expected
      }
      return {
        success: true,
        message: "Reboot command sent. Device will restart shortly.",
      };
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
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = `/tmp/backup-${timestamp}.tar.gz`;
      await client.executeCommand(`sysupgrade -b ${shellQuote(backupPath)}`, { timeout: PACKAGE_TIMEOUT });

      return {
        success: true,
        message: "Configuration backup created",
        backup_path: backupPath,
        note: "Backup saved on router. Use file_read or scp to retrieve it.",
      };
    },
  },
];
