# Releases

## 2.1.0 (2026-09-08)

Requires Node.js 22.12+ or 24+ (`engines` added). Dev toolchain: TypeScript 7, vitest 5.

### Output and timeouts
- `openwrt_system_execute_command` returns `{exit_code, output, stderr}` and no longer throws on a non-zero exit code; accepts `timeout_ms` (1 s – 10 min)
- `executeCommand()` errors now include the command's stdout (truncated to 4 KB) next to stderr
- `openwrt_script_execute` accepts `timeout_ms`; `openwrt_service_control` start/stop/restart/reload use a 90 s timeout
- Timeout message notes that the remote process may still be running
- New `OPENWRT_READY_TIMEOUT` env var for the SSH handshake (default raised from 10 s to 30 s)

### Correctness
- SSH output is decoded with `StringDecoder`, so multi-byte UTF-8 characters split across packets are no longer mangled
- `openwrt_file_write` / `openwrt_file_append` verify the on-disk size against the payload and report `bytes_written` / `bytes_appended`
- `openwrt_file_read` caps output (`max_bytes`, default 256 KiB), reports `size`/`truncated`, supports `tail_lines`, and omits binary content
- `openwrt_file_backup` defaults to `/root/backups/<path>.backup-<ts>` and refuses destinations inside wholesale-read directories (`/etc/dnsmasq.d`, `/etc/config`, `/etc/init.d`, …)
- `openwrt_dns_set_dhcp_range` creates the `dhcp.<iface>` section when missing instead of failing with "Invalid argument"
- `uciAddSection()` refuses to silently re-type an existing section; `allowExisting` gives idempotent "ensure" semantics
- `openwrt_network_set_dhcp` reverts staged changes on failure like the other mutating tools
- UCI config/section/option names are validated inside the client (`validateUciSectionRef` accepts `@type[N]` references)

### DNS
- `name` is optional in `openwrt_dns_add_static_host`, `openwrt_dns_add_cname` and `openwrt_dns_add_static_lease`; when omitted an anonymous section is created via `uci add` and its id is returned as `section` (fixes hostnames with hyphens)

### WireGuard
- Private and preshared keys are stored via `uci batch` on stdin (`uciSetSecret()`), and public keys are derived by piping into `wg pubkey`, so key material never appears in `ps`
- All keys are validated as 44-character base64 (`validateWgKey`)

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
