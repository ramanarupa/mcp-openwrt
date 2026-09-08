import { describe, it, expect } from "vitest";
import {
  shellQuote,
  validateName,
  validateUciSectionName,
  validateMode,
  extractWireguardConfig,
  validateUciSectionRef,
  validateWgKey,
  assertSafeBackupDestination,
} from "../utils.js";

describe("shellQuote", () => {
  it("wraps simple strings in single quotes", () => {
    expect(shellQuote("hello")).toBe("'hello'");
  });

  it("escapes embedded single quotes", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it("handles strings with $() command substitution", () => {
    const result = shellQuote("$(rm -rf /)");
    expect(result).toBe("'$(rm -rf /)'");
  });

  it("handles strings with backtick command substitution", () => {
    const result = shellQuote("`cmd`");
    expect(result).toBe("'`cmd`'");
  });

  it("handles strings with semicolons", () => {
    const result = shellQuote("; drop");
    expect(result).toBe("'; drop'");
  });

  it("handles strings with double quotes", () => {
    const result = shellQuote('"double"');
    expect(result).toBe("'\"double\"'");
  });

  it("handles strings with shell variables", () => {
    const result = shellQuote("$VAR");
    expect(result).toBe("'$VAR'");
  });

  it("handles empty string", () => {
    expect(shellQuote("")).toBe("''");
  });

  it("handles strings with newlines", () => {
    const result = shellQuote("line1\nline2");
    expect(result).toBe("'line1\nline2'");
  });

  it("handles strings with tabs", () => {
    const result = shellQuote("col1\tcol2");
    expect(result).toBe("'col1\tcol2'");
  });

  it("handles strings with multiple single quotes", () => {
    const result = shellQuote("it's a 'test'");
    expect(result).toBe("'it'\\''s a '\\''test'\\'''");
  });
});

describe("validateName", () => {
  it("accepts simple names", () => {
    expect(() => validateName("wg0", "test")).not.toThrow();
  });

  it("accepts names with hyphens", () => {
    expect(() => validateName("my-service", "test")).not.toThrow();
  });

  it("accepts names with dots", () => {
    expect(() => validateName("backup.sh", "test")).not.toThrow();
  });

  it("accepts names with underscores", () => {
    expect(() => validateName("lan_2", "test")).not.toThrow();
  });

  it("rejects path traversal", () => {
    expect(() => validateName("../etc", "test")).toThrow("Invalid test");
  });

  it("rejects semicolons", () => {
    expect(() => validateName("name;cmd", "test")).toThrow("Invalid test");
  });

  it("rejects spaces", () => {
    expect(() => validateName("a b", "test")).toThrow("Invalid test");
  });

  it("rejects command substitution", () => {
    expect(() => validateName("$(cmd)", "test")).toThrow("Invalid test");
  });

  it("rejects empty string", () => {
    expect(() => validateName("", "test")).toThrow("Invalid test");
  });

  it("rejects slashes", () => {
    expect(() => validateName("/path", "test")).toThrow("Invalid test");
  });

  it("includes label in error message", () => {
    expect(() => validateName("bad name", "service name")).toThrow("Invalid service name");
  });
});

describe("validateMode", () => {
  it("accepts 3-digit modes", () => {
    expect(() => validateMode("755")).not.toThrow();
    expect(() => validateMode("644")).not.toThrow();
  });

  it("accepts 4-digit modes", () => {
    expect(() => validateMode("0755")).not.toThrow();
    expect(() => validateMode("0644")).not.toThrow();
  });

  it("rejects modes with non-octal digits", () => {
    expect(() => validateMode("999")).toThrow("Invalid file mode");
  });

  it("rejects modes with letters", () => {
    expect(() => validateMode("abc")).toThrow("Invalid file mode");
  });

  it("rejects modes with trailing letters", () => {
    expect(() => validateMode("7777x")).toThrow("Invalid file mode");
  });

  it("rejects 2-digit modes", () => {
    expect(() => validateMode("75")).toThrow("Invalid file mode");
  });

  it("rejects empty string", () => {
    expect(() => validateMode("")).toThrow("Invalid file mode");
  });
});

describe("validateUciSectionName", () => {
  it("accepts letters, digits, and underscores", () => {
    expect(() => validateUciSectionName("wg0", "test")).not.toThrow();
    expect(() => validateUciSectionName("wg_vps", "test")).not.toThrow();
    expect(() => validateUciSectionName("lan_2", "test")).not.toThrow();
  });

  it("rejects hyphens (invalid in UCI section names)", () => {
    expect(() => validateUciSectionName("my-host", "entry name")).toThrow("Invalid entry name");
  });

  it("rejects dots (would misparse the UCI path)", () => {
    expect(() => validateUciSectionName("a.b", "test")).toThrow("Invalid test");
  });

  it("rejects spaces, empty strings, and shell metacharacters", () => {
    expect(() => validateUciSectionName("a b", "test")).toThrow("Invalid test");
    expect(() => validateUciSectionName("", "test")).toThrow("Invalid test");
    expect(() => validateUciSectionName("$(cmd)", "test")).toThrow("Invalid test");
    expect(() => validateUciSectionName("../etc", "test")).toThrow("Invalid test");
  });

  it("includes label in error message", () => {
    expect(() => validateUciSectionName("bad-name", "route name")).toThrow("Invalid route name");
  });
});

describe("extractWireguardConfig", () => {
  const sample = [
    "network.lan=interface",
    "network.lan.proto='static'",
    "network.lan.ipaddr='192.168.108.1'",
    "network.wg_vps=interface",
    "network.wg_vps.proto='wireguard'",
    "network.wg_vps.private_key='SUPERSECRET='",
    "network.wg_vps.listen_port='10810'",
    "network.wg0=interface",
    "network.wg0.proto='wireguard'",
    "network.wg0.private_key='SECRET2='",
    "network.wg0_peer1=wireguard_wg0",
    "network.wg0_peer1.public_key='PUBKEY='",
    "network.wg0_peer1.preshared_key='PSK='",
    "network.@wireguard_wg_vps[0]=wireguard_wg_vps",
    "network.@wireguard_wg_vps[0].public_key='PUBKEY2='",
  ].join("\n");

  it("includes interfaces with proto=wireguard regardless of name (wg_vps, wg0)", () => {
    const result = extractWireguardConfig(sample);
    expect(result).toContain("network.wg_vps.listen_port='10810'");
    expect(result).toContain("network.wg0.proto='wireguard'");
  });

  it("includes named and anonymous peer sections", () => {
    const result = extractWireguardConfig(sample);
    expect(result).toContain("network.wg0_peer1.public_key='PUBKEY='");
    expect(result).toContain("network.@wireguard_wg_vps[0].public_key='PUBKEY2='");
  });

  it("excludes non-WireGuard sections", () => {
    const result = extractWireguardConfig(sample);
    expect(result).not.toContain("network.lan");
  });

  it("redacts private and preshared keys", () => {
    const result = extractWireguardConfig(sample);
    expect(result).not.toContain("SUPERSECRET");
    expect(result).not.toContain("SECRET2");
    expect(result).not.toContain("'PSK='");
    expect(result).toContain("network.wg_vps.private_key='<redacted>'");
    expect(result).toContain("network.wg0_peer1.preshared_key='<redacted>'");
  });

  it("does not redact public keys", () => {
    const result = extractWireguardConfig(sample);
    expect(result).toContain("PUBKEY=");
  });

  it("returns empty string when no WireGuard config exists", () => {
    expect(extractWireguardConfig("network.lan=interface\nnetwork.lan.proto='static'")).toBe("");
  });
});

describe("validateUciSectionRef", () => {
  it("accepts named sections and anonymous references", () => {
    expect(() => validateUciSectionRef("lan", "s")).not.toThrow();
    expect(() => validateUciSectionRef("wg_vps_peer1", "s")).not.toThrow();
    expect(() => validateUciSectionRef("@dnsmasq[0]", "s")).not.toThrow();
    expect(() => validateUciSectionRef("@rule[-1]", "s")).not.toThrow();
  });

  it("rejects hyphens, dots, spaces and shell metacharacters", () => {
    for (const bad of ["my-host", "a.b", "a b", "lan;id", "@dnsmasq", "@dnsmasq[x]", ""]) {
      expect(() => validateUciSectionRef(bad, "s")).toThrow("Invalid s");
    }
  });
});

describe("validateWgKey", () => {
  const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

  it("returns a well-formed key unchanged", () => {
    expect(validateWgKey(key, "k")).toBe(key);
    expect(validateWgKey("abc+/0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZab=", "k")).toBeTruthy();
  });

  it("rejects malformed keys", () => {
    for (const bad of ["", "short", key.slice(0, 43), key + "=", key.replace("=", "!"), "x\n" + key, 42]) {
      expect(() => validateWgKey(bad as any, "private_key")).toThrow("Invalid private_key");
    }
  });
});

describe("assertSafeBackupDestination", () => {
  it("allows /root/backups and /tmp", () => {
    expect(() => assertSafeBackupDestination("/root/backups/etc/dnsmasq.d/x.conf.backup-1")).not.toThrow();
    expect(() => assertSafeBackupDestination("/tmp/network.bak")).not.toThrow();
    expect(() => assertSafeBackupDestination("/etc/config.bak")).not.toThrow();
  });

  it("refuses wholesale-read directories", () => {
    expect(() => assertSafeBackupDestination("/etc/dnsmasq.d/x.conf.bak")).toThrow("/etc/dnsmasq.d");
    expect(() => assertSafeBackupDestination("/etc/config/network.bak")).toThrow("/etc/config");
    expect(() => assertSafeBackupDestination("/etc/init.d/foo.bak")).toThrow("/etc/init.d");
    expect(() => assertSafeBackupDestination("/etc/hotplug.d/iface/99-x.bak")).toThrow("/etc/hotplug.d");
    expect(() => assertSafeBackupDestination("/etc/crontabs/root.bak")).toThrow("/etc/crontabs");
  });
});
