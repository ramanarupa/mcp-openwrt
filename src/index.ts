#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { OpenWRTClient } from "./openwrt-client.js";
import { networkTools } from "./tools/network.js";
import { dnsTools } from "./tools/dns.js";
import { wireguardTools } from "./tools/wireguard.js";
import { systemTools } from "./tools/system.js";
import { fileTools } from "./tools/files.js";
import { serviceTools } from "./tools/services.js";
import { scriptTools } from "./tools/scripts.js";
import { resources } from "./resources.js";
import { prompts } from "./prompts.js";

// Read configuration from environment variables
const config = {
  host: process.env.OPENWRT_HOST || "192.168.1.1",
  port: parseInt(process.env.OPENWRT_PORT || "22"),
  username: process.env.OPENWRT_USERNAME || "root",
  password: process.env.OPENWRT_PASSWORD,
  privateKey: process.env.OPENWRT_PRIVATE_KEY,
};

// Validate configuration
if (!config.password && !config.privateKey) {
  console.error("Error: Either OPENWRT_PASSWORD or OPENWRT_PRIVATE_KEY must be set");
  process.exit(1);
}

// Initialize OpenWRT client
const openwrtClient = new OpenWRTClient(config);

// Create MCP server
const server = new Server(
  {
    name: "openwrt-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

// Combine all tools
const allTools = [
  ...networkTools,
  ...dnsTools,
  ...wireguardTools,
  ...systemTools,
  ...fileTools,
  ...serviceTools,
  ...scriptTools,
];

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: allTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const tool = allTools.find((t) => t.name === toolName);

  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  try {
    const result = await tool.handler(openwrtClient, request.params.arguments || {});
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Handle resource listing
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: resources.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
    })),
  };
});

// Handle resource reading
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const resourceUri = request.params.uri;

  // Check if it's a dynamic file resource (openwrt://file/path/to/file)
  if (resourceUri.startsWith("openwrt://file/")) {
    const filePath = resourceUri.replace("openwrt://file", "");

    try {
      const content = await openwrtClient.readFile(filePath);
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: "text/plain",
            text: content,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read file ${filePath}: ${errorMessage}`);
    }
  }

  // Otherwise, find static resource
  const resource = resources.find((r) => r.uri === resourceUri);

  if (!resource) {
    throw new Error(`Unknown resource: ${resourceUri}`);
  }

  try {
    const content = await resource.handler(openwrtClient);
    return {
      contents: [
        {
          uri: resourceUri,
          mimeType: resource.mimeType || "text/plain",
          text: content,
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read resource: ${errorMessage}`);
  }
});

// Handle prompt listing
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: prompts.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments,
    })),
  };
});

// Handle prompt retrieval
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const promptName = request.params.name;
  const prompt = prompts.find((p) => p.name === promptName);

  if (!prompt) {
    throw new Error(`Unknown prompt: ${promptName}`);
  }

  const messages = await prompt.handler(request.params.arguments || {});
  return {
    messages,
  };
});

// Start server
async function main() {
  // Connect to OpenWRT on startup
  try {
    await openwrtClient.connect();
    console.error("Connected to OpenWRT device");
  } catch (error) {
    console.error("Failed to connect to OpenWRT:", error);
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("OpenWRT MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
