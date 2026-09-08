import { OpenWRTClient } from "../openwrt-client.js";
import { Tool } from "../types.js";
import {
  shellQuote,
  validateMode,
  validateInt,
  validateAbsolutePath,
  assertSafeBackupDestination,
} from "../utils.js";

/** Default cap for file_read so a log or archive cannot flood the context. */
const DEFAULT_READ_LIMIT = 256 * 1024;
const MAX_READ_LIMIT = 16 * 1024 * 1024;
/** Where file_backup puts copies unless told otherwise (survives reboot, not sysupgrade). */
const BACKUP_ROOT = "/root/backups";

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "/" : path.slice(0, idx);
}

export const fileTools: Tool[] = [
  {
    name: "openwrt_file_read",
    description:
      "Read a file from the OpenWRT filesystem. Output is capped at max_bytes (default 256 KiB); the response reports the real size and whether it was truncated. Use tail_lines to read only the end of a log.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Full path to the file (e.g., '/etc/config/network', '/root/script.sh')",
        },
        max_bytes: {
          type: "number",
          description: "Maximum number of bytes to return (default 262144, max 16777216)",
        },
        tail_lines: {
          type: "number",
          description: "Return only the last N lines (like `tail -n N`). Ignores max_bytes.",
        },
      },
      required: ["path"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { path, max_bytes, tail_lines } = args;

      if (tail_lines !== undefined) {
        const n = validateInt(tail_lines, "tail_lines", 1, 1_000_000);
        const content = await client.executeCommand(`tail -n ${n} ${shellQuote(path)}`);
        return {
          success: true,
          path,
          tail_lines: n,
          content,
        };
      }

      const limit =
        max_bytes === undefined ? DEFAULT_READ_LIMIT : validateInt(max_bytes, "max_bytes", 1, MAX_READ_LIMIT);
      const { content, size, truncated } = await client.readFileLimited(path, limit);

      if (content.includes("\u0000")) {
        return {
          success: true,
          path,
          size,
          binary: true,
          message: "File contains NUL bytes (binary); content omitted. Use openwrt_system_execute_command with base64/hexdump if you need it.",
        };
      }

      return {
        success: true,
        path,
        size,
        truncated,
        ...(truncated ? { message: `Showing first ${limit} of ${size} bytes; raise max_bytes or use tail_lines` } : {}),
        content,
      };
    },
  },
  {
    name: "openwrt_file_write",
    description:
      "Write content to a file on the OpenWRT filesystem byte-for-byte (no newline is added). The on-disk size is verified against the payload and returned as bytes_written.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Full path to the file",
        },
        content: {
          type: "string",
          description: "Content to write to the file (include a trailing newline yourself if the file needs one)",
        },
        mode: {
          type: "string",
          description: "File permissions (optional, e.g., '755', '644')",
        },
      },
      required: ["path", "content"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { path, content, mode } = args;

      if (mode) {
        validateMode(mode);
      }

      const bytesWritten = await client.writeFile(path, content);

      if (mode) {
        await client.executeCommand(`chmod ${mode} ${shellQuote(path)}`);
      }

      return {
        success: true,
        message: `File written successfully: ${path}`,
        path,
        bytes_written: bytesWritten,
        ends_with_newline: content.endsWith("\n"),
      };
    },
  },
  {
    name: "openwrt_file_append",
    description: "Append content to an existing file byte-for-byte; the size change is verified.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Full path to the file",
        },
        content: {
          type: "string",
          description: "Content to append to the file",
        },
      },
      required: ["path", "content"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { path, content } = args;

      const size = await client.appendFile(path, content);

      return {
        success: true,
        message: `Content appended to ${path}`,
        bytes_appended: Buffer.byteLength(content, "utf8"),
        size,
      };
    },
  },
  {
    name: "openwrt_file_delete",
    description: "Delete a file from the OpenWRT filesystem",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Full path to the file to delete",
        },
        confirm: {
          type: "boolean",
          description: "Must be set to true to confirm deletion",
        },
      },
      required: ["path", "confirm"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { path, confirm } = args;

      if (!confirm) {
        return {
          success: false,
          message: "Deletion not confirmed. Set confirm to true to proceed.",
        };
      }

      await client.executeCommand(`rm -f ${shellQuote(path)}`);
      return {
        success: true,
        message: `File deleted: ${path}`,
      };
    },
  },
  {
    name: "openwrt_file_list_directory",
    description: "List contents of a directory",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path (e.g., '/etc', '/root')",
        },
        detailed: {
          type: "boolean",
          description: "Show detailed listing with permissions and sizes",
        },
      },
      required: ["path"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { path, detailed } = args;

      const command = detailed
        ? `ls -lah ${shellQuote(path)}`
        : `ls -A ${shellQuote(path)}`;
      const output = await client.executeCommand(command);

      return {
        success: true,
        path,
        listing: output,
      };
    },
  },
  {
    name: "openwrt_file_create_directory",
    description: "Create a new directory",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Full path to the directory to create",
        },
        parents: {
          type: "boolean",
          description: "Create parent directories if they don't exist",
        },
      },
      required: ["path"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { path, parents } = args;

      const command = parents
        ? `mkdir -p ${shellQuote(path)}`
        : `mkdir ${shellQuote(path)}`;
      await client.executeCommand(command);

      return {
        success: true,
        message: `Directory created: ${path}`,
      };
    },
  },
  {
    name: "openwrt_file_search_content",
    description: "Search for text content in files",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Directory to search in (e.g., '/etc')",
        },
        pattern: {
          type: "string",
          description: "Text pattern to search for",
        },
        file_pattern: {
          type: "string",
          description: "File name pattern (optional, e.g., '*.conf')",
        },
      },
      required: ["directory", "pattern"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { directory, pattern, file_pattern } = args;

      try {
        let command: string;
        if (file_pattern) {
          command = `find ${shellQuote(directory)} -name ${shellQuote(file_pattern)} -exec grep -H -F -- ${shellQuote(pattern)} {} \\;`;
        } else {
          command = `grep -r -F -- ${shellQuote(pattern)} ${shellQuote(directory)}`;
        }

        const output = await client.executeCommand(command);

        return {
          success: true,
          matches: output,
        };
      } catch (error) {
        // grep returns non-zero exit code when no matches found
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("exit code 1") || errorMsg.includes("code 1")) {
          return {
            success: true,
            matches: "",
            message: "No matches found",
          };
        }
        throw error;
      }
    },
  },
  {
    name: "openwrt_file_backup",
    description:
      `Create a backup copy of a file or directory. By default the copy goes under ${BACKUP_ROOT}/<original path>.backup-<timestamp>, never next to the original: directories such as /etc/dnsmasq.d, /etc/config or /etc/init.d load every file they contain, so an in-place .bak would take effect as config. Explicit backup_path values inside such directories are rejected.`,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to file or directory to backup",
        },
        backup_path: {
          type: "string",
          description: `Backup destination (optional, defaults to ${BACKUP_ROOT}/<path>.backup-<timestamp>)`,
        },
      },
      required: ["path"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { path, backup_path } = args;

      validateAbsolutePath(path, "path");

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const destination: string = backup_path || `${BACKUP_ROOT}${path}.backup-${timestamp}`;
      validateAbsolutePath(destination, "backup_path");
      assertSafeBackupDestination(destination);

      await client.executeCommand(`mkdir -p ${shellQuote(dirname(destination))}`);
      await client.executeCommand(`cp -r ${shellQuote(path)} ${shellQuote(destination)}`);

      return {
        success: true,
        message: `Backup created: ${destination}`,
        backup_path: destination,
        note: `${BACKUP_ROOT} survives reboot but not sysupgrade; copy elsewhere if you need it longer.`,
      };
    },
  },
];
