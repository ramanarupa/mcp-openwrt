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
 * Return a heredoc delimiter that does not collide with the content.
 * Starts with "EOFMCP" and appends an incrementing suffix if needed.
 */
export function uniqueHeredocDelimiter(content: string): string {
  let delimiter = "EOFMCP";
  let suffix = 0;
  const lines = content.split("\n");
  while (lines.some((line) => line === delimiter)) {
    suffix++;
    delimiter = `EOFMCP${suffix}`;
  }
  return delimiter;
}
