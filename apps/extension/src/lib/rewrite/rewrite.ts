export const REWRITE_EXAMPLE_URL = "https://example.com/article/123?ref=home#comments";
export const DEFAULT_REWRITE = String.raw`# Commands run in order. Use JSON string escaping in parameters.
# URL rule: example.com
# Input: https://example.com/article/123?ref=home#comments
# Output: https://example.com/reader/123

# filter: continue only if the current URL matches
filter "^https://example\\.com/article/"

# exclude: stop this update if the current URL matches
exclude "/private/"

# replace: replace the first match; $1, $2 refer to capture groups
replace "/article/(\\d+)" "/reader/$1"

# Remove query parameters and fragments
replace "[?#].*$" ""`;

interface RewriteCommand {
  kind: "filter" | "exclude" | "replace";
  pattern: RegExp;
  replacement: string;
  line: number;
}
export type RewriteResult = { ok: true; url: string | null; line?: number } | { ok: false; error: string };

function parse(source: string): RewriteCommand[] {
  const commands: RewriteCommand[] = [];
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const text = raw.trim();
    if (!text || text.startsWith("#")) continue;
    const line = index + 1;
    try {
      const match = /^(\w+)\s+("(?:[^"\\]|\\.)*")(?:\s+("(?:[^"\\]|\\.)*"))?$/.exec(text);
      if (!match) throw new Error('Expected: filter "regex", exclude "regex", or replace "regex" "replacement"');
      const kind = match[1];
      if (kind !== "filter" && kind !== "exclude" && kind !== "replace") throw new Error(`Unknown command: ${kind}`);
      if ((kind === "replace") !== (match[3] !== undefined)) throw new Error("Wrong number of arguments");
      const pattern = new RegExp(JSON.parse(match[2]!) as string);
      const replacement = match[3] ? JSON.parse(match[3]) as string : "";
      commands.push({ kind, pattern, replacement, line });
    } catch (error) {
      throw new Error(`Line ${line}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  return commands;
}

export function validateRewrite(source: string): string | undefined {
  try { parse(source); return undefined; }
  catch (error) { return error instanceof Error ? error.message : String(error); }
}

export function applyRewrite(source: string, inputUrl: string): RewriteResult {
  try {
    const commands = parse(source);
    if (!commands.length) return { ok: true, url: null };
    let url = inputUrl;
    for (const command of commands) {
      if (command.kind === "replace") url = url.replace(command.pattern, command.replacement);
      else {
        const matched = command.pattern.test(url);
        if ((command.kind === "filter" && !matched) || (command.kind === "exclude" && matched))
          return { ok: true, url: null, line: command.line };
      }
    }
    return { ok: true, url };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
