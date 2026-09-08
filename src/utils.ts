/**
 * Wrap a value in single quotes for safe shell interpolation.
 * Embedded single quotes are escaped with the '\'' idiom.
 */
export function shellQuote(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * Validate that a value contains only safe identifier characters.
 * Allows: letters, digits, dots, hyphens, underscores.
 * Throws on anything else (spaces, slashes, semicolons, etc.).
 */
export function validateName(value: string, label: string): void {
  if (!value || !/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(
      `Invalid ${label}: ${JSON.stringify(value)}. Only letters, digits, dots, hyphens, and underscores are allowed.`
    );
  }
}

/**
 * Validate a UCI section name. Unlike validateName, UCI section identifiers
 * allow ONLY letters, digits, and underscores — a hyphen or dot makes
 * `uci set config.section.option` fail with "Invalid argument" (or silently
 * misparse the path in the case of dots).
 */
export function validateUciSectionName(value: string, label: string): void {
  if (!value || !/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(
      `Invalid ${label}: ${JSON.stringify(value)}. UCI section names allow only letters, digits, and underscores (no hyphens or dots).`
    );
  }
}

/**
 * Validate a Unix file permission mode string (e.g. "755", "0644").
 */
export function validateMode(mode: string): void {
  if (!mode || !/^[0-7]{3,4}$/.test(mode)) {
    throw new Error(
      `Invalid file mode: ${JSON.stringify(mode)}. Expected 3 or 4 octal digits (e.g. "755", "0644").`
    );
  }
}

/**
 * Validate that a path is absolute and does not contain traversal sequences.
 * Throws on relative paths, ".." components, or empty strings.
 */
export function validateAbsolutePath(value: string, label: string): void {
  if (!value || !value.startsWith("/") || /(?:^|\/)\.\.(\/|$)/.test(value)) {
    throw new Error(
      `Invalid ${label}: ${JSON.stringify(value)}. Must be an absolute path without ".." components.`
    );
  }
}

/**
 * Validate that a value is a safe integer within the given range.
 */
export function validateInt(value: unknown, label: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(
      `Invalid ${label}: ${JSON.stringify(value)}. Must be an integer between ${min} and ${max}.`
    );
  }
  return n;
}

/**
 * Escape a value for safe embedding inside single-quoted shell strings.
 * Unlike shellQuote, this returns just the escaped content without surrounding quotes —
 * useful when interpolating into a shell variable assignment like: VAR='<escaped>'
 */
export function shellEscape(arg: string): string {
  return arg.replace(/'/g, "'\\''");
}

/**
 * Extract WireGuard-related lines from `uci show network` output and redact
 * key material. Finds interface sections by proto='wireguard' (works for any
 * interface name, e.g. wg_vps, not just wg0) plus their peer sections
 * (type wireguard_<iface>, named or anonymous), and replaces private_key /
 * preshared_key values with '<redacted>' so keys never leak into tool output.
 */
export function extractWireguardConfig(uciOutput: string): string {
  const lines = uciOutput.split("\n");
  const wgSections = new Set<string>();

  for (const line of lines) {
    // Interface sections: network.<name>.proto='wireguard'
    let m = line.match(/^network\.([^.=]+)\.proto='wireguard'$/);
    if (m) {
      wgSections.add(m[1]);
      continue;
    }
    // Peer sections: network.<name>=wireguard_<iface> (named)
    // or network.@wireguard_<iface>[N]=wireguard_<iface> (anonymous)
    m = line.match(/^network\.([^.=]+)=wireguard_/);
    if (m) {
      wgSections.add(m[1]);
    }
  }

  return lines
    .filter((line) => {
      const m = line.match(/^network\.([^.=]+)/);
      return m !== null && wgSections.has(m[1]);
    })
    .map((line) =>
      line.replace(/^(network\.[^.=]+\.(?:private_key|preshared_key))='.*'$/, "$1='<redacted>'")
    )
    .join("\n");
}

/**
 * Validate a UCI section reference as used in `uci set/get` paths: either a
 * named section (letters, digits, underscores) or an anonymous reference
 * such as `@dnsmasq[0]` / `@rule[-1]`.
 */
export function validateUciSectionRef(value: string, label: string): void {
  if (!value || !/^(?:[A-Za-z0-9_]+|@[A-Za-z0-9_]+\[-?\d+\])$/.test(value)) {
    throw new Error(
      `Invalid ${label}: ${JSON.stringify(value)}. Expected a UCI section name (letters, digits, underscores) or an anonymous reference like "@dnsmasq[0]".`
    );
  }
}

/**
 * Validate a WireGuard key (private, public or preshared): 32 bytes of
 * base64, i.e. 43 base64 characters followed by "=".
 */
export function validateWgKey(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error(`Invalid ${label}: expected a 44-character base64 WireGuard key.`);
  }
  return value;
}

/**
 * Directories whose *every* file is read as configuration by some daemon or
 * boot hook. A backup copy dropped inside one of them is silently loaded as
 * config (dnsmasq picks up `/etc/dnsmasq.d/*.bak`, procd runs `/etc/init.d/*`,
 * uci treats every file in `/etc/config/` as a package, …).
 */
export const WHOLESALE_READ_DIRS = [
  "/etc/config",
  "/etc/dnsmasq.d",
  "/etc/init.d",
  "/etc/rc.d",
  "/etc/rc.button",
  "/etc/hotplug.d",
  "/etc/crontabs",
  "/etc/uci-defaults",
  "/etc/sysctl.d",
  "/etc/modules.d",
  "/etc/modules-boot.d",
  "/etc/nftables.d",
  "/etc/firewall.d",
  "/etc/profile.d",
  "/etc/ppp/ip-up.d",
  "/etc/ppp/ip-down.d",
  "/etc/udhcpc.user.d",
  "/etc/wireguard",
];

/**
 * Throw when `destination` lives inside a directory that is read wholesale
 * (see WHOLESALE_READ_DIRS). Used to keep backups from being loaded as config.
 */
export function assertSafeBackupDestination(destination: string): void {
  for (const dir of WHOLESALE_READ_DIRS) {
    if (destination === dir || destination.startsWith(dir + "/")) {
      throw new Error(
        `Refusing to write a backup inside ${dir}: every file in that directory is loaded as configuration, so the copy would take effect too. Use a destination under /root/backups or /tmp.`
      );
    }
  }
}
