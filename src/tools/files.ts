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

export const fileTools: Tool[] = [
  {
    name: "openwrt_file_read",
    description: "Read any file from the OpenWRT filesystem",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Full path to the file (e.g., '/etc/config/network', '/root/script.sh')",
        },
      },
      required: ["path"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { path } = args;

      try {
        const content = await client.readFile(path);
        return {
          success: true,
          path,
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
    name: "openwrt_file_write",
    description: "Write content to a file on the OpenWRT filesystem",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Full path to the file",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
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

      try {
        await client.writeFile(path, content);

        if (mode) {
          await client.executeCommand(`chmod ${mode} ${path}`);
        }

        return {
          success: true,
          message: `File written successfully: ${path}`,
          path,
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
    name: "openwrt_file_append",
    description: "Append content to an existing file",
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

      try {
        // Escape single quotes in content
        const escapedContent = content.replace(/'/g, "'\\''");
        await client.executeCommand(`echo '${escapedContent}' >> ${path}`);

        return {
          success: true,
          message: `Content appended to ${path}`,
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

      try {
        await client.executeCommand(`rm -f ${path}`);
        return {
          success: true,
          message: `File deleted: ${path}`,
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

      try {
        const command = detailed ? `ls -lah ${path}` : `ls -A ${path}`;
        const output = await client.executeCommand(command);

        return {
          success: true,
          path,
          listing: output,
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

      try {
        const command = parents ? `mkdir -p ${path}` : `mkdir ${path}`;
        await client.executeCommand(command);

        return {
          success: true,
          message: `Directory created: ${path}`,
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
        let command = `grep -r "${pattern}" ${directory}`;
        if (file_pattern) {
          command = `find ${directory} -name "${file_pattern}" -exec grep -H "${pattern}" {} \\;`;
        }

        const output = await client.executeCommand(command);

        return {
          success: true,
          matches: output,
        };
      } catch (error) {
        // grep returns non-zero exit code when no matches found
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("No such file") || errorMsg.includes("not found")) {
          return {
            success: true,
            matches: "",
            message: "No matches found",
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
    name: "openwrt_file_backup",
    description: "Create a backup of a file or directory",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to file or directory to backup",
        },
        backup_path: {
          type: "string",
          description: "Backup destination (optional, defaults to path.backup with timestamp)",
        },
      },
      required: ["path"],
    },
    handler: async (client: OpenWRTClient, args: Record<string, any>) => {
      const { path, backup_path } = args;

      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const destination = backup_path || `${path}.backup-${timestamp}`;

        await client.executeCommand(`cp -r ${path} ${destination}`);

        return {
          success: true,
          message: `Backup created: ${destination}`,
          backup_path: destination,
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
