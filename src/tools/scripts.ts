import { OpenWRTClient } from "../openwrt-client.js";
import { Tool } from "../types.js";
import { shellQuote } from "../utils.js";

export const scriptTools: Tool[] = [
  {
    name: "openwrt_script_create",
    description: "Create a shell script in /root/ or any specified location",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Script name (e.g., 'backup.sh', 'monitor.sh')",
        },
        content: {
          type: "string",
          description: "Script content (bash/sh script)",
        },
        directory: {
          type: "string",
          description: "Directory to create script in (default: /root)",
        },
        executable: {
          type: "boolean",
          description: "Make script executable (default: true)",
        },
        shebang: {
          type: "string",
          description: "Shebang line (default: '#!/bin/sh')",
        },
      },
      required: ["name", "content"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const {
        name,
        content,
        directory = "/root",
        executable = true,
        shebang = "#!/bin/sh",
      } = args;

      const scriptPath = `${directory}/${name}`;

      // Add shebang if not present
      const fullContent = content.startsWith("#!")
        ? content
        : `${shebang}\n\n${content}`;

      // Write script
      await client.writeFile(scriptPath, fullContent);

      // Make executable if requested
      if (executable) {
        await client.executeCommand(`chmod +x ${shellQuote(scriptPath)}`);
      }

      return {
        success: true,
        message: `Script created successfully: ${scriptPath}`,
        path: scriptPath,
        executable,
      };
    },
  },
  {
    name: "openwrt_script_execute",
    description: "Execute a script and return its output",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Full path to the script",
        },
        args: {
          type: "string",
          description: "Arguments to pass to the script (optional)",
        },
        background: {
          type: "boolean",
          description: "Run in background (default: false)",
        },
      },
      required: ["path"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { path, args: scriptArgs = "", background = false } = args;

      // path is quoted; scriptArgs is intentionally raw (user-supplied shell args)
      const command = background
        ? `${shellQuote(path)} ${scriptArgs} &`
        : `${shellQuote(path)} ${scriptArgs}`;
      const output = await client.executeCommand(command);

      return {
        success: true,
        output,
        background,
      };
    },
  },
  {
    name: "openwrt_script_template_backup",
    description: "Create a backup script from a template",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Script name (default: 'backup.sh')",
        },
        backup_dirs: {
          type: "array",
          description: "Directories to backup (default: ['/etc/config', '/root'])",
          items: {
            type: "string",
          },
        },
        destination: {
          type: "string",
          description: "Backup destination directory (default: '/tmp/backups')",
        },
      },
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const {
        name = "backup.sh",
        backup_dirs = ["/etc/config", "/root"],
        destination = "/tmp/backups",
      } = args;

      const dirsString = backup_dirs.join(" ");
      const scriptContent = `#!/bin/sh
# Automatic backup script
# Created by OpenWRT MCP Server

BACKUP_DIRS="${dirsString}"
DEST_DIR="${destination}"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$DEST_DIR/backup_$DATE.tar.gz"

# Create destination directory if it doesn't exist
mkdir -p "$DEST_DIR"

# Create backup
echo "Creating backup..."
tar -czf "$BACKUP_FILE" $BACKUP_DIRS 2>/dev/null

if [ $? -eq 0 ]; then
    echo "Backup created successfully: $BACKUP_FILE"

    # Keep only last 5 backups
    ls -t "$DEST_DIR"/backup_*.tar.gz | tail -n +6 | xargs -r rm

    echo "Old backups cleaned up"
else
    echo "Backup failed!"
    exit 1
fi
`;

      const scriptPath = `/root/${name}`;
      await client.writeFile(scriptPath, scriptContent);
      await client.executeCommand(`chmod +x ${shellQuote(scriptPath)}`);

      // Create destination directory
      await client.executeCommand(`mkdir -p ${shellQuote(destination)}`);

      return {
        success: true,
        message: `Backup script created: ${scriptPath}`,
        path: scriptPath,
        script: scriptContent,
      };
    },
  },
  {
    name: "openwrt_script_template_monitor",
    description: "Create a system monitoring script from a template",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Script name (default: 'monitor.sh')",
        },
        email: {
          type: "string",
          description: "Email address to send alerts (optional)",
        },
        log_file: {
          type: "string",
          description: "Log file path (default: '/var/log/monitor.log')",
        },
      },
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const {
        name = "monitor.sh",
        email = "",
        log_file = "/var/log/monitor.log",
      } = args;

      const emailAlert = email
        ? `echo "$MESSAGE" | sendmail ${email}`
        : `echo "$MESSAGE" >> ${log_file}`;

      const scriptContent = `#!/bin/sh
# System monitoring script
# Created by OpenWRT MCP Server

LOG_FILE="${log_file}"
ALERT_THRESHOLD_CPU=80
ALERT_THRESHOLD_MEM=90

# Function to send alert
send_alert() {
    MESSAGE="$1"
    ${emailAlert}
}

# Check CPU load
CPU_LOAD=$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}' | sed 's/,//')
CPU_LOAD_INT=$(echo "$CPU_LOAD" | awk '{printf "%.0f", $1 * 100}')

if [ "$CPU_LOAD_INT" -gt "$ALERT_THRESHOLD_CPU" ]; then
    send_alert "ALERT: High CPU load: $CPU_LOAD"
fi

# Check memory usage
MEM_USAGE=$(free | grep Mem | awk '{printf "%.0f", ($3/$2) * 100}')

if [ "$MEM_USAGE" -gt "$ALERT_THRESHOLD_MEM" ]; then
    send_alert "ALERT: High memory usage: $MEM_USAGE%"
fi

# Check disk usage
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')

if [ "$DISK_USAGE" -gt 90 ]; then
    send_alert "ALERT: High disk usage: $DISK_USAGE%"
fi

# Log current status
echo "$(date): CPU=$CPU_LOAD MEM=$MEM_USAGE% DISK=$DISK_USAGE%" >> $LOG_FILE
`;

      const scriptPath = `/root/${name}`;
      await client.writeFile(scriptPath, scriptContent);
      await client.executeCommand(`chmod +x ${shellQuote(scriptPath)}`);

      return {
        success: true,
        message: `Monitor script created: ${scriptPath}`,
        path: scriptPath,
        script: scriptContent,
        note: "You can add this script to crontab to run periodically",
      };
    },
  },
  {
    name: "openwrt_script_list",
    description: "List all scripts in a directory",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Directory to list scripts from (default: /root)",
        },
        pattern: {
          type: "string",
          description: "File pattern (default: '*.sh')",
        },
      },
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { directory = "/root", pattern = "*.sh" } = args;

      try {
        const output = await client.executeCommand(
          `find ${shellQuote(directory)} -maxdepth 1 -name ${shellQuote(pattern)} -exec ls -lh {} +`
        );

        return {
          success: true,
          directory,
          scripts: output || "No scripts found",
        };
      } catch (error) {
        return {
          success: true,
          directory,
          scripts: "No scripts found",
        };
      }
    },
  },
];
