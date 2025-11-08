# OpenWRT MCP Server

MCP (Model Context Protocol) server for configuring and managing OpenWRT routers through Claude Code. This server provides comprehensive tools, resources, and prompts for network management, VPN configuration, system administration, and more via OpenWRT's ubus API and SSH.

## Features

### 🌐 Network Management
- List and inspect network interfaces
- Configure static IP addresses
- Enable DHCP on interfaces
- Add static routes
- View and analyze network configuration

### 🔒 WireGuard VPN
- Create WireGuard interfaces
- Add and remove VPN peers
- Generate key pairs
- View WireGuard status and configuration
- Full server and client setup support

### 🛡️ DNS & DHCP Management
- Set upstream DNS servers
- Add static DNS host entries (A records)
- Add CNAME records
- Configure DHCP ranges
- Add static DHCP leases (MAC to IP bindings)

### 🔧 System Administration
- Execute shell commands
- Manage packages (install/remove)
- Control services (start/stop/restart)
- View system information and logs
- Backup configuration
- Reboot device

### 📁 File Management
- Read any file from filesystem
- Write/create files
- Append to files
- Delete files
- List directory contents
- Search file contents
- Create directories
- Backup files

### ⚙️ Service Management
- Create custom init.d services
- Create simple services from commands
- Delete services
- View service scripts
- Manage cron jobs (add/remove/list)

### 📝 Script Management
- Create shell scripts in /root/ or anywhere
- Execute scripts
- Template scripts (backup, monitoring)
- List scripts in directories

### 📚 Resources (Read Configuration Files)
- Network configuration
- Wireless settings
- Firewall rules
- DHCP/DNS settings
- System configuration
- WireGuard configuration
- System and network status
- System logs
- **Dynamic file access**: Read any file using `openwrt://file/path/to/file`

### 💡 Smart Prompts
- **Analyze Configuration** - Comprehensive config analysis with recommendations
- **Setup WireGuard Server** - Guided VPN server setup
- **Add WireGuard Client** - Easy client/peer addition
- **Security Audit** - Full security assessment
- **Optimize Network** - Performance optimization
- **Troubleshoot Connectivity** - Diagnostic and fixes
- **Setup Guest Network** - Isolated guest WiFi

## Prerequisites

- Node.js 18+ and npm
- OpenWRT router with SSH access
- SSH credentials (password or private key)

## Installation

1. Clone or download this repository
2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Configuration

The server is configured via environment variables:

- `OPENWRT_HOST` - Router IP address (default: 192.168.1.1)
- `OPENWRT_PORT` - SSH port (default: 22)
- `OPENWRT_USERNAME` - SSH username (default: root)
- `OPENWRT_PASSWORD` - SSH password (required if no private key)
- `OPENWRT_PRIVATE_KEY` - SSH private key path (required if no password)

### Example: Using Password Authentication

Create a `.env` file or set environment variables:

```bash
export OPENWRT_HOST=192.168.1.1
export OPENWRT_USERNAME=root
export OPENWRT_PASSWORD=your_password
```

### Example: Using SSH Key Authentication

```bash
export OPENWRT_HOST=192.168.1.1
export OPENWRT_USERNAME=root
export OPENWRT_PRIVATE_KEY="$(cat ~/.ssh/id_rsa)"
```

## Setting Up with Claude Code

1. Build the project:
```bash
npm run build
```

2. Add the server to your Claude Code MCP settings.

On Windows, edit `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "openwrt": {
      "command": "node",
      "args": ["E:\\OpenWRT\\mcp\\build\\index.js"],
      "env": {
        "OPENWRT_HOST": "192.168.1.1",
        "OPENWRT_USERNAME": "root",
        "OPENWRT_PASSWORD": "your_password"
      }
    }
  }
}
```

On macOS/Linux, edit `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "openwrt": {
      "command": "node",
      "args": ["/path/to/mcp/build/index.js"],
      "env": {
        "OPENWRT_HOST": "192.168.1.1",
        "OPENWRT_USERNAME": "root",
        "OPENWRT_PASSWORD": "your_password"
      }
    }
  }
}
```

3. Restart Claude Code

## Available Tools

### Network Tools

#### `openwrt_network_list_interfaces`
List all network interfaces on the OpenWRT device.

#### `openwrt_network_get_interface`
Get detailed information about a specific network interface.
- `interface` (required): Interface name (e.g., 'lan', 'wan')

#### `openwrt_network_set_static_ip`
Set a static IP address for a network interface.
- `interface` (required): Interface name
- `ipaddr` (required): IP address
- `netmask` (required): Network mask
- `gateway` (optional): Gateway address

#### `openwrt_network_set_dhcp`
Set a network interface to use DHCP.
- `interface` (required): Interface name

#### `openwrt_network_show_config`
Show the current network configuration.

#### `openwrt_network_add_static_route`
Add a static route to the routing table.
- `name` (required): Route identifier
- `target` (required): Target network (e.g., '10.0.0.0/24')
- `gateway` (required): Gateway IP address
- `interface` (optional): Interface name

### DNS Tools

#### `openwrt_dns_show_config`
Show the current DNS and DHCP configuration.

#### `openwrt_dns_set_upstream_servers`
Set upstream DNS servers for the OpenWRT device.
- `servers` (required): Array of DNS server IPs

#### `openwrt_dns_add_static_host`
Add a static DNS host entry (A record).
- `name` (required): Entry identifier
- `hostname` (required): Hostname to resolve
- `ip` (required): IP address

#### `openwrt_dns_add_cname`
Add a DNS CNAME record.
- `name` (required): Entry identifier
- `cname` (required): CNAME alias
- `target` (required): Target hostname

#### `openwrt_dns_set_dhcp_range`
Configure DHCP range for a network interface.
- `interface` (required): Interface name
- `start` (required): Start of DHCP range
- `limit` (required): Number of addresses
- `leasetime` (required): Lease time (e.g., '12h', '7d')

#### `openwrt_dns_add_static_lease`
Add a static DHCP lease (MAC to IP binding).
- `name` (required): Entry identifier
- `mac` (required): MAC address
- `ip` (required): IP address to assign
- `hostname` (optional): Hostname

### WireGuard VPN Tools

#### `openwrt_wireguard_show_interfaces`
List all WireGuard interfaces and their configurations.

#### `openwrt_wireguard_create_interface`
Create a new WireGuard interface.
- `name` (required): Interface name (e.g., 'wg0')
- `private_key` (optional): Private key (will generate if not provided)
- `listen_port` (required): UDP listen port (e.g., 51820)
- `addresses` (required): Array of IP addresses for the interface

#### `openwrt_wireguard_add_peer`
Add a peer to a WireGuard interface.
- `interface` (required): WireGuard interface name
- `peer_name` (required): Unique name for the peer
- `public_key` (required): Public key of the peer
- `allowed_ips` (required): Array of allowed IP addresses
- `endpoint` (optional): Peer endpoint address:port
- `persistent_keepalive` (optional): Keepalive interval in seconds
- `preshared_key` (optional): Preshared key for additional security

#### `openwrt_wireguard_remove_peer`
Remove a peer from a WireGuard interface.
- `interface` (required): WireGuard interface name
- `peer_name` (required): Name of the peer to remove

#### `openwrt_wireguard_generate_keypair`
Generate a new WireGuard key pair (private and public keys).

#### `openwrt_wireguard_show_config`
Show the current WireGuard configuration from UCI.

### System Administration Tools

#### `openwrt_system_info`
Get system information (uptime, load, memory, etc.).

#### `openwrt_system_board_info`
Get board/hardware information.

#### `openwrt_system_execute_command`
Execute a shell command on the OpenWRT device (use with caution).
- `command` (required): Shell command to execute

#### `openwrt_system_list_processes`
List running processes.

#### `openwrt_system_disk_usage`
Show disk usage statistics.

#### `openwrt_package_list_installed`
List installed packages.
- `filter` (optional): Filter packages by name

#### `openwrt_package_install`
Install a package using opkg.
- `package` (required): Package name to install

#### `openwrt_package_remove`
Remove a package using opkg.
- `package` (required): Package name to remove

#### `openwrt_service_list`
List all available services.

#### `openwrt_service_control`
Control a service (start, stop, restart, enable, disable).
- `service` (required): Service name
- `action` (required): Action to perform (start/stop/restart/reload/enable/disable/status)

#### `openwrt_system_reboot`
Reboot the OpenWRT device.
- `confirm` (required): Must be set to true to confirm reboot

#### `openwrt_system_backup_config`
Create a backup of the current configuration.

### File Management Tools

#### `openwrt_file_read`
Read any file from the OpenWRT filesystem.
- `path` (required): Full path to the file

#### `openwrt_file_write`
Write content to a file on the OpenWRT filesystem.
- `path` (required): Full path to the file
- `content` (required): Content to write
- `mode` (optional): File permissions (e.g., '755', '644')

#### `openwrt_file_append`
Append content to an existing file.
- `path` (required): Full path to the file
- `content` (required): Content to append

#### `openwrt_file_delete`
Delete a file from the OpenWRT filesystem.
- `path` (required): Full path to the file
- `confirm` (required): Must be true to confirm deletion

#### `openwrt_file_list_directory`
List contents of a directory.
- `path` (required): Directory path
- `detailed` (optional): Show detailed listing with permissions

#### `openwrt_file_create_directory`
Create a new directory.
- `path` (required): Full path to directory
- `parents` (optional): Create parent directories if needed

#### `openwrt_file_search_content`
Search for text content in files.
- `directory` (required): Directory to search in
- `pattern` (required): Text pattern to search for
- `file_pattern` (optional): File name pattern (e.g., '*.conf')

#### `openwrt_file_backup`
Create a backup of a file or directory.
- `path` (required): Path to backup
- `backup_path` (optional): Backup destination

### Service Management Tools

#### `openwrt_service_create`
Create a new init.d service script.
- `name` (required): Service name
- `script_content` (required): Complete init.d script content
- `start_priority` (optional): Start priority
- `stop_priority` (optional): Stop priority
- `enable` (optional): Enable service on boot

#### `openwrt_service_create_simple`
Create a simple init.d service from a command.
- `name` (required): Service name
- `description` (optional): Service description
- `start_command` (required): Command to run on start
- `stop_command` (optional): Command to run on stop
- `start_priority` (optional): Start priority (default: 95)
- `stop_priority` (optional): Stop priority (default: 10)
- `enable` (optional): Enable service on boot

#### `openwrt_service_delete`
Delete an init.d service.
- `name` (required): Service name
- `confirm` (required): Must be true to confirm

#### `openwrt_service_view`
View the content of an init.d service script.
- `name` (required): Service name

#### `openwrt_cron_list`
List all cron jobs.

#### `openwrt_cron_add`
Add a new cron job.
- `schedule` (required): Cron schedule (e.g., '0 2 * * *')
- `command` (required): Command to execute
- `comment` (optional): Comment to identify the job

#### `openwrt_cron_remove`
Remove cron jobs matching a pattern.
- `pattern` (required): Pattern to match
- `confirm` (required): Must be true to confirm

### Script Management Tools

#### `openwrt_script_create`
Create a shell script in /root/ or any specified location.
- `name` (required): Script name
- `content` (required): Script content
- `directory` (optional): Directory to create script in (default: /root)
- `executable` (optional): Make script executable (default: true)
- `shebang` (optional): Shebang line (default: '#!/bin/sh')

#### `openwrt_script_execute`
Execute a script and return its output.
- `path` (required): Full path to the script
- `args` (optional): Arguments to pass to the script
- `background` (optional): Run in background

#### `openwrt_script_template_backup`
Create a backup script from a template.
- `name` (optional): Script name (default: 'backup.sh')
- `backup_dirs` (optional): Directories to backup
- `destination` (optional): Backup destination directory

#### `openwrt_script_template_monitor`
Create a system monitoring script from a template.
- `name` (optional): Script name (default: 'monitor.sh')
- `email` (optional): Email for alerts
- `log_file` (optional): Log file path

#### `openwrt_script_list`
List all scripts in a directory.
- `directory` (optional): Directory (default: /root)
- `pattern` (optional): File pattern (default: '*.sh')

### Available Resources

Resources allow Claude to read configuration files and system status directly:

- `openwrt://config/network` - Network configuration
- `openwrt://config/wireless` - WiFi configuration
- `openwrt://config/dhcp` - DHCP and DNS configuration
- `openwrt://config/firewall` - Firewall rules
- `openwrt://config/system` - System settings
- `openwrt://config/wireguard` - WireGuard VPN configuration
- `openwrt://status/system` - Current system status (JSON)
- `openwrt://status/network` - Network interfaces status (JSON)
- `openwrt://logs/system` - Recent system logs
- `openwrt://logs/kernel` - Recent kernel logs
- `openwrt://file/path/to/file` - **Dynamic**: Read any file by specifying its path

### Smart Prompts

Prompts provide guided workflows for common tasks:

- `analyze-config` - Analyze configuration and provide recommendations
- `setup-wireguard-server` - Set up a WireGuard VPN server
- `add-wireguard-client` - Add a new WireGuard client/peer
- `optimize-network` - Analyze and optimize network performance
- `security-audit` - Perform a comprehensive security audit
- `troubleshoot-connectivity` - Troubleshoot network connectivity issues
- `setup-guest-network` - Set up an isolated guest WiFi network

## Usage Examples

Once configured in Claude Code, you can ask Claude to manage your OpenWRT router:

### Example 1: Check Network Interfaces
```
Show me all network interfaces on my OpenWRT router
```

### Example 2: Configure Static IP
```
Set the LAN interface to use static IP 192.168.1.1 with netmask 255.255.255.0
```

### Example 3: Add DNS Entry
```
Add a static DNS entry: myserver.local pointing to 192.168.1.100
```

### Example 4: Configure DHCP
```
Configure DHCP on the lan interface: start at 100, limit 150 addresses, lease time 12h
```

### Example 5: Add Static Route
```
Add a static route named 'office_network' for 10.0.0.0/24 via gateway 192.168.1.254
```

### Example 6: Analyze Configuration
```
Analyze my OpenWRT configuration and provide security recommendations
```

### Example 7: Setup WireGuard VPN
```
Set up a WireGuard VPN server on wg0 interface with port 51820 and subnet 10.0.0.1/24
```

### Example 8: Add WireGuard Client
```
Add a WireGuard peer named "laptop" with IP 10.0.0.2 to the wg0 interface
```

### Example 9: View Configuration Files
```
Show me the current network configuration file and explain what it does
```

### Example 10: Install Package
```
Install the wireguard-tools package
```

### Example 11: Troubleshoot Connectivity
```
I can't access the internet from LAN clients, help me troubleshoot
```

### Example 12: Security Audit
```
Perform a security audit of my router
```

### Example 13: Create a Custom Service
```
Create a simple init.d service called 'myapp' that starts '/root/myapp.py' on boot
```

### Example 14: Create a Backup Script
```
Create a backup script that backs up /etc/config and /root directories to /tmp/backups
```

### Example 15: Read Any Config File
```
Read the file /etc/dnsmasq.conf and explain its configuration
```

### Example 16: Create a Monitoring Script
```
Create a monitoring script that checks CPU, memory, and disk usage every 5 minutes
```

### Example 17: Manage Cron Jobs
```
Add a cron job to run /root/backup.sh every day at 2 AM
```

### Example 18: Search for Configuration
```
Search for all files in /etc that contain the word "firewall"
```

## Development

### Project Structure
```
mcp/
├── src/
│   ├── index.ts              # Main MCP server with handlers
│   ├── openwrt-client.ts     # OpenWRT SSH/ubus/UCI client
│   ├── resources.ts          # MCP Resources (config files, logs)
│   ├── prompts.ts            # Smart prompts for common tasks
│   └── tools/
│       ├── network.ts        # Network management (6 tools)
│       ├── dns.ts            # DNS/DHCP management (6 tools)
│       ├── wireguard.ts      # WireGuard VPN (6 tools)
│       ├── system.ts         # System administration (12 tools)
│       ├── files.ts          # File management (8 tools)
│       ├── services.ts       # Service & cron management (7 tools)
│       └── scripts.ts        # Script creation & management (5 tools)
├── build/                    # Compiled JavaScript output
├── package.json
├── tsconfig.json
├── .gitignore
├── .env.example
└── README.md
```

**Total: 50 tools, 10+ resources, 7 smart prompts**

### Building
```bash
npm run build
```

### Watch Mode (for development)
```bash
npm run watch
```

## Security Considerations

- Store credentials securely (use environment variables or SSH keys)
- Avoid committing credentials to version control
- Use SSH key authentication when possible
- Ensure your OpenWRT device is on a trusted network
- Consider using a VPN if accessing remotely

## Troubleshooting

### Connection Issues
- Verify SSH access: `ssh root@192.168.1.1`
- Check firewall rules on OpenWRT
- Ensure SSH server is running on OpenWRT

### Permission Errors
- Verify the user has sudo/root access
- Check OpenWRT user permissions

### Tool Errors
- Check OpenWRT logs: `/var/log/messages`
- Verify ubus is running: `ubus list`
- Check UCI configuration: `uci show`

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT

## Disclaimer

This tool makes changes to your router configuration. Always test in a safe environment first and ensure you have a way to recover if something goes wrong (e.g., physical access to the router, backup configuration).
