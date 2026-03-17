# Releases

## 2.0.0

**Breaking: requires OpenWRT 25.x or later** (apk package manager; opkg is no longer supported).

### Security hardening
- Validate `name` and `directory` in `script_create` to prevent path traversal
- Validate `interface` in `dns_set_dhcp_range` (was the only tool missing this check)
- Fix template injection in `script_template_backup` and `script_template_monitor` — user-supplied values are now shell-escaped with single quotes
- Validate `path` and `method` components in `ubusCall` to prevent shell injection
- Validate `start_priority` / `stop_priority` as integers (0-99) in `service_create_simple`

### Reliability
- UCI rollback (`uci revert`) on failure for all multi-step operations: `wireguard_create_interface`, `wireguard_add_peer`, `network_set_static_ip`, `network_add_static_route`, `dns_add_static_host`, `dns_add_cname`, `dns_set_dhcp_range`, `dns_add_static_lease`

### New utilities
- `validateAbsolutePath()` — rejects relative paths and `..` traversal
- `validateInt()` — runtime integer range check
- `shellEscape()` — escape content for embedding inside single-quoted shell strings
- `uciRevert()` — revert uncommitted UCI changes

## 1.1.0

- Added tests for shell injection prevention across all tools
- Switched package management from `opkg` to `apk`
- Added `shellQuote`, `validateName`, `validateMode`, `uniqueHeredocDelimiter` utilities
- Security: confirm gates on destructive operations (reboot, execute_command, file_delete, service_delete, cron_remove)
- SSH reconnection with keepalive and connection deduplication

## 1.0.0

Initial release.

- 50 tools: network, DNS/DHCP, WireGuard, system, files, services, scripts
- 10+ resources for reading config files and system status
- 7 smart prompts for guided workflows
- SSH/ubus/UCI client with timeout and error handling
