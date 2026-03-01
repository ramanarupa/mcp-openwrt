import { describe, it, expect } from "vitest";
import { shellQuote, validateName, validateMode, uniqueHeredocDelimiter } from "../utils.js";

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

describe("uniqueHeredocDelimiter", () => {
  it("returns EOFMCP when content has no collision", () => {
    expect(uniqueHeredocDelimiter("some content here")).toBe("EOFMCP");
  });

  it("returns EOFMCP1 when content contains EOFMCP on a line", () => {
    expect(uniqueHeredocDelimiter("line1\nEOFMCP\nline3")).toBe("EOFMCP1");
  });

  it("returns EOFMCP2 when content contains both EOFMCP and EOFMCP1", () => {
    expect(uniqueHeredocDelimiter("EOFMCP\nEOFMCP1\nline3")).toBe("EOFMCP2");
  });

  it("does not collide with EOFMCP as substring", () => {
    // "someEOFMCPtext" is a line that does NOT equal "EOFMCP", so no collision
    expect(uniqueHeredocDelimiter("someEOFMCPtext")).toBe("EOFMCP");
  });
});
