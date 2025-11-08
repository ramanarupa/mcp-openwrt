export interface Prompt {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
  handler: (args: Record<string, any>) => Promise<Array<{
    role: "user" | "assistant";
    content: {
      type: "text";
      text: string;
    };
  }>>;
}

export const prompts: Prompt[] = [
  {
    name: "analyze-config",
    description: "Analyze the current OpenWRT configuration and provide recommendations",
    handler: async () => {
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please analyze the OpenWRT configuration by:

1. Reading all configuration files (network, wireless, firewall, dhcp, system)
2. Reading the current system status
3. Analyzing the configuration for:
   - Security issues (default passwords, open ports, weak settings)
   - Performance optimization opportunities
   - Network configuration issues
   - Potential improvements
4. Provide specific recommendations with commands to fix any issues found

Please be thorough and provide actionable recommendations.`,
          },
        },
      ];
    },
  },
  {
    name: "setup-wireguard-server",
    description: "Guide through setting up a WireGuard VPN server",
    arguments: [
      {
        name: "interface_name",
        description: "Name for the WireGuard interface (e.g., 'wg0')",
        required: false,
      },
      {
        name: "port",
        description: "UDP port to listen on (default: 51820)",
        required: false,
      },
      {
        name: "subnet",
        description: "VPN subnet (default: 10.0.0.1/24)",
        required: false,
      },
    ],
    handler: async (args) => {
      const interfaceName = args.interface_name || "wg0";
      const port = args.port || 51820;
      const subnet = args.subnet || "10.0.0.1/24";

      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please set up a WireGuard VPN server with the following configuration:

Interface: ${interfaceName}
Port: ${port}
Subnet: ${subnet}

Steps to complete:
1. Check if WireGuard is installed (if not, install wireguard-tools package)
2. Generate a key pair for the server
3. Create the WireGuard interface with the specified settings
4. Configure firewall rules to allow WireGuard traffic
5. Set up IP forwarding and masquerading for VPN clients
6. Provide the server's public key and configuration for clients

Please complete all steps and provide the final configuration details.`,
          },
        },
      ];
    },
  },
  {
    name: "add-wireguard-client",
    description: "Add a new client to an existing WireGuard server",
    arguments: [
      {
        name: "interface",
        description: "WireGuard interface name",
        required: true,
      },
      {
        name: "client_name",
        description: "Name for the client",
        required: true,
      },
      {
        name: "client_ip",
        description: "IP address for the client (e.g., 10.0.0.2)",
        required: true,
      },
    ],
    handler: async (args) => {
      const { interface: iface, client_name, client_ip } = args;

      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please add a new WireGuard client with the following details:

Interface: ${iface}
Client Name: ${client_name}
Client IP: ${client_ip}

Steps to complete:
1. Generate a key pair for the client
2. Add the client as a peer to the WireGuard interface
3. Generate a complete client configuration file that the user can use
4. Show the QR code command for mobile clients (using qrencode if available)

Provide all configuration details and keys.`,
          },
        },
      ];
    },
  },
  {
    name: "optimize-network",
    description: "Analyze and optimize network performance",
    handler: async () => {
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please analyze the network configuration and optimize for performance:

1. Check current network interface settings
2. Analyze DNS configuration and response times
3. Check for any network bottlenecks
4. Review DHCP settings
5. Analyze wireless configuration (if applicable)
6. Check for any misconfigurations
7. Provide optimization recommendations with specific commands

Focus on improving throughput, reducing latency, and ensuring stable connections.`,
          },
        },
      ];
    },
  },
  {
    name: "security-audit",
    description: "Perform a security audit of the OpenWRT configuration",
    handler: async () => {
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please perform a comprehensive security audit:

1. Check firewall rules and zones
2. Review open ports and services
3. Check for default passwords or weak authentication
4. Review wireless security settings
5. Check for unnecessary services running
6. Review system logs for suspicious activity
7. Check for available security updates
8. Verify SSH configuration security

Provide a detailed report with:
- Current security status
- Vulnerabilities found (if any)
- Specific recommendations to improve security
- Commands to implement fixes`,
          },
        },
      ];
    },
  },
  {
    name: "troubleshoot-connectivity",
    description: "Troubleshoot network connectivity issues",
    arguments: [
      {
        name: "issue_description",
        description: "Description of the connectivity issue",
        required: false,
      },
    ],
    handler: async (args) => {
      const issueDesc = args.issue_description || "general connectivity problems";

      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please troubleshoot connectivity issues: ${issueDesc}

Diagnostic steps:
1. Check all network interface statuses
2. Review system logs for errors
3. Check DNS resolution
4. Test gateway connectivity
5. Review firewall rules
6. Check DHCP status
7. Review routing table
8. Test external connectivity

Analyze the results and provide:
- Root cause of the issue
- Step-by-step solution
- Preventive measures`,
          },
        },
      ];
    },
  },
  {
    name: "setup-guest-network",
    description: "Set up an isolated guest WiFi network",
    arguments: [
      {
        name: "ssid",
        description: "SSID for the guest network",
        required: true,
      },
      {
        name: "password",
        description: "Password for the guest network",
        required: false,
      },
    ],
    handler: async (args) => {
      const { ssid, password } = args;

      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please set up an isolated guest WiFi network:

SSID: ${ssid}
Password: ${password || "(open network)"}

Requirements:
1. Create a new wireless network with the specified SSID
2. Create a separate network interface for guests
3. Set up DHCP for the guest network (different subnet)
4. Configure firewall rules to:
   - Allow guest internet access
   - Block access to main LAN
   - Block access to router admin interface
   - Isolate guests from each other
5. Apply and test the configuration

Provide complete configuration and verification steps.`,
          },
        },
      ];
    },
  },
];
