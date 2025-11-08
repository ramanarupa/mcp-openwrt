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

export const serviceTools: Tool[] = [
  {
    name: "openwrt_service_create",
    description: "Create a new init.d service script",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Service name (e.g., 'myservice')",
        },
        script_content: {
          type: "string",
          description: "Complete init.d script content (should include START, STOP, start(), stop() functions)",
        },
        start_priority: {
          type: "number",
          description: "Start priority (e.g., 95, lower numbers start earlier)",
        },
        stop_priority: {
          type: "number",
          description: "Stop priority (e.g., 10)",
        },
        enable: {
          type: "boolean",
          description: "Enable the service on boot",
        },
      },
      required: ["name", "script_content"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { name, script_content, start_priority, stop_priority, enable } = args;

      try {
        const servicePath = `/etc/init.d/${name}`;

        // Write the service script
        await client.writeFile(servicePath, script_content);

        // Make it executable
        await client.executeCommand(`chmod +x ${servicePath}`);

        // Enable if requested
        if (enable) {
          await client.executeCommand(`${servicePath} enable`);
        }

        return {
          success: true,
          message: `Service ${name} created successfully`,
          path: servicePath,
          enabled: enable || false,
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
    name: "openwrt_service_create_simple",
    description: "Create a simple init.d service from a command",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Service name",
        },
        description: {
          type: "string",
          description: "Service description",
        },
        start_command: {
          type: "string",
          description: "Command to run on start",
        },
        stop_command: {
          type: "string",
          description: "Command to run on stop (optional, will use killall by default)",
        },
        start_priority: {
          type: "number",
          description: "Start priority (default: 95)",
        },
        stop_priority: {
          type: "number",
          description: "Stop priority (default: 10)",
        },
        enable: {
          type: "boolean",
          description: "Enable the service on boot",
        },
      },
      required: ["name", "start_command"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const {
        name,
        description,
        start_command,
        stop_command,
        start_priority = 95,
        stop_priority = 10,
        enable,
      } = args;

      const stopCmd = stop_command || `killall ${name}`;
      const desc = description || `${name} service`;

      const scriptContent = `#!/bin/sh /etc/rc.common
# ${desc}

START=${start_priority}
STOP=${stop_priority}

start() {
    echo "Starting ${name}"
    ${start_command}
}

stop() {
    echo "Stopping ${name}"
    ${stopCmd}
}

restart() {
    stop
    sleep 2
    start
}
`;

      try {
        const servicePath = `/etc/init.d/${name}`;

        // Write the service script
        await client.writeFile(servicePath, scriptContent);

        // Make it executable
        await client.executeCommand(`chmod +x ${servicePath}`);

        // Enable if requested
        if (enable) {
          await client.executeCommand(`${servicePath} enable`);
        }

        return {
          success: true,
          message: `Simple service ${name} created successfully`,
          path: servicePath,
          enabled: enable || false,
          script: scriptContent,
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
    name: "openwrt_service_delete",
    description: "Delete an init.d service",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Service name to delete",
        },
        confirm: {
          type: "boolean",
          description: "Must be set to true to confirm deletion",
        },
      },
      required: ["name", "confirm"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { name, confirm } = args;

      if (!confirm) {
        return {
          success: false,
          message: "Deletion not confirmed. Set confirm to true to proceed.",
        };
      }

      try {
        const servicePath = `/etc/init.d/${name}`;

        // Disable and stop the service first
        try {
          await client.executeCommand(`${servicePath} stop`);
          await client.executeCommand(`${servicePath} disable`);
        } catch (error) {
          // Ignore errors if service is not running or enabled
        }

        // Delete the service file
        await client.executeCommand(`rm -f ${servicePath}`);

        return {
          success: true,
          message: `Service ${name} deleted successfully`,
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
    name: "openwrt_service_view",
    description: "View the content of an init.d service script",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Service name",
        },
      },
      required: ["name"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { name } = args;

      try {
        const servicePath = `/etc/init.d/${name}`;
        const content = await client.readFile(servicePath);

        return {
          success: true,
          name,
          path: servicePath,
          content,
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
    name: "openwrt_cron_list",
    description: "List all cron jobs",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (client: OpenWRTClient) => {
      try {
        const output = await client.executeCommand("crontab -l");
        return {
          success: true,
          crontab: output,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("no crontab")) {
          return {
            success: true,
            crontab: "",
            message: "No crontab entries found",
          };
        }
        return {
          success: false,
          error: errorMsg,
        };
      }
    },
  },
  {
    name: "openwrt_cron_add",
    description: "Add a new cron job",
    inputSchema: {
      type: "object",
      properties: {
        schedule: {
          type: "string",
          description: "Cron schedule (e.g., '0 2 * * *' for daily at 2am)",
        },
        command: {
          type: "string",
          description: "Command to execute",
        },
        comment: {
          type: "string",
          description: "Optional comment to identify the job",
        },
      },
      required: ["schedule", "command"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { schedule, command, comment } = args;

      try {
        // Get current crontab
        let currentCron = "";
        try {
          currentCron = await client.executeCommand("crontab -l");
        } catch (error) {
          // No crontab yet, that's fine
        }

        // Add new entry
        const commentLine = comment ? `# ${comment}\n` : "";
        const newEntry = `${commentLine}${schedule} ${command}`;
        const newCron = currentCron ? `${currentCron}\n${newEntry}` : newEntry;

        // Write new crontab
        await client.executeCommand(`echo "${newCron}" | crontab -`);

        // Restart cron service
        await client.executeCommand("/etc/init.d/cron restart");

        return {
          success: true,
          message: "Cron job added successfully",
          entry: newEntry,
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
    name: "openwrt_cron_remove",
    description: "Remove cron jobs matching a pattern",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Pattern to match in cron entries (will remove all matching lines)",
        },
        confirm: {
          type: "boolean",
          description: "Must be set to true to confirm deletion",
        },
      },
      required: ["pattern", "confirm"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { pattern, confirm } = args;

      if (!confirm) {
        return {
          success: false,
          message: "Deletion not confirmed. Set confirm to true to proceed.",
        };
      }

      try {
        // Get current crontab
        const currentCron = await client.executeCommand("crontab -l");

        // Filter out matching lines
        const lines = currentCron.split("\n");
        const filteredLines = lines.filter((line) => !line.includes(pattern));
        const newCron = filteredLines.join("\n");

        // Write new crontab
        await client.executeCommand(`echo "${newCron}" | crontab -`);

        // Restart cron service
        await client.executeCommand("/etc/init.d/cron restart");

        const removedCount = lines.length - filteredLines.length;

        return {
          success: true,
          message: `${removedCount} cron job(s) removed`,
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
