import { OpenWRTClient } from "../openwrt-client.js";
import { Tool } from "../types.js";
import { shellQuote, shellEscape, validateName, validateInt } from "../utils.js";

/**
 * Read the current crontab, returning "" when none exists.
 * Matches both GNU/vixie ("no crontab for root") and busybox
 * ("crontab: can't open 'root': No such file or directory") messages.
 */
async function readCrontab(client: OpenWRTClient): Promise<string> {
  try {
    return await client.executeCommand("crontab -l");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes("no crontab") || errorMsg.includes("can't open")) {
      return "";
    }
    throw error;
  }
}

/**
 * Replace the crontab via stdin (`crontab -`) and restart cron.
 */
async function writeCrontab(client: OpenWRTClient, content: string): Promise<void> {
  const normalized = content.length === 0 || content.endsWith("\n") ? content : content + "\n";
  await client.executeCommand("crontab -", { stdin: normalized });
  await client.executeCommand("/etc/init.d/cron restart");
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
      const { name, script_content, enable } = args;

      validateName(name, "service name");
      const servicePath = `/etc/init.d/${name}`;

      // Write the service script
      await client.writeFile(servicePath, script_content);

      // Make it executable
      await client.executeCommand(`chmod +x ${shellQuote(servicePath)}`);

      // Enable if requested
      if (enable) {
        await client.executeCommand(`${shellQuote(servicePath)} enable`);
      }

      return {
        success: true,
        message: `Service ${name} created successfully`,
        path: servicePath,
        enabled: enable || false,
      };
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
          description: "Extra cleanup to run on stop (optional; procd stops the supervised process itself)",
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

      validateName(name, "service name");
      const safeStartPriority = validateInt(start_priority, "start_priority", 0, 99);
      const safeStopPriority = validateInt(stop_priority, "stop_priority", 0, 99);

      const desc = description || `${name} service`;

      // Optional extra cleanup — procd itself stops the supervised process
      const stopBlock = stop_command
        ? `
stop_service() {
    ${stop_command}
}
`
        : "";

      // procd-supervised service (standard on modern OpenWrt): the command is
      // tracked and respawned, and \`stop\` works even if it doesn't daemonize
      const scriptContent = `#!/bin/sh /etc/rc.common
# ${desc}

USE_PROCD=1
START=${safeStartPriority}
STOP=${safeStopPriority}

start_service() {
    procd_open_instance
    procd_set_param command /bin/sh -c '${shellEscape(start_command)}'
    procd_set_param respawn
    procd_close_instance
}
${stopBlock}`;

      const servicePath = `/etc/init.d/${name}`;

      // Write the service script
      await client.writeFile(servicePath, scriptContent);

      // Make it executable
      await client.executeCommand(`chmod +x ${shellQuote(servicePath)}`);

      // Enable if requested
      if (enable) {
        await client.executeCommand(`${shellQuote(servicePath)} enable`);
      }

      return {
        success: true,
        message: `Simple service ${name} created successfully`,
        path: servicePath,
        enabled: enable || false,
        script: scriptContent,
      };
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

      validateName(name, "service name");
      const servicePath = `/etc/init.d/${name}`;

      // Disable and stop the service first (best-effort)
      try {
        await client.executeCommand(`${shellQuote(servicePath)} stop`);
        await client.executeCommand(`${shellQuote(servicePath)} disable`);
      } catch (error) {
        // Ignore errors if service is not running or enabled
      }

      // Delete the service file
      await client.executeCommand(`rm -f ${shellQuote(servicePath)}`);

      return {
        success: true,
        message: `Service ${name} deleted successfully`,
      };
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

      validateName(name, "service name");
      const servicePath = `/etc/init.d/${name}`;
      const content = await client.readFile(servicePath);

      return {
        success: true,
        name,
        path: servicePath,
        content,
      };
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
      const output = await readCrontab(client);
      return {
        success: true,
        crontab: output,
        ...(output === "" ? { message: "No crontab entries found" } : {}),
      };
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

      const currentCron = await readCrontab(client);

      // Add new entry
      const commentLine = comment ? `# ${comment}\n` : "";
      const newEntry = `${commentLine}${schedule} ${command}`;
      const newCron = currentCron.trimEnd() ? `${currentCron.trimEnd()}\n${newEntry}` : newEntry;

      await writeCrontab(client, newCron);

      return {
        success: true,
        message: "Cron job added successfully",
        entry: newEntry,
      };
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

      if (!pattern) {
        throw new Error("Pattern must be a non-empty string (an empty pattern would wipe the entire crontab)");
      }

      const currentCron = await readCrontab(client);

      // Filter out matching lines, dropping the comment line cron_add put
      // directly above a removed entry (avoids orphaned comments)
      const lines = currentCron.split("\n");
      const filteredLines: string[] = [];
      let removedCount = 0;
      for (const line of lines) {
        if (line.includes(pattern)) {
          removedCount++;
          const prev = filteredLines[filteredLines.length - 1];
          if (prev !== undefined && prev.trim().startsWith("#")) {
            filteredLines.pop();
          }
          continue;
        }
        filteredLines.push(line);
      }

      await writeCrontab(client, filteredLines.join("\n"));

      return {
        success: true,
        message: `${removedCount} cron job(s) removed`,
      };
    },
  },
];
