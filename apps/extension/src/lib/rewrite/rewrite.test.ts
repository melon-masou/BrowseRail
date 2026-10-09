import { expect, it } from "vitest";
import { applyRewrite, DEFAULT_REWRITE, REWRITE_EXAMPLE_URL, validateRewrite } from "./rewrite";

it("runs the provided example and keeps whitespace and # inside string arguments", () => {
  expect(applyRewrite(DEFAULT_REWRITE, REWRITE_EXAMPLE_URL)).toEqual({ ok: true, url: "https://example.com/reader/123" });
  expect(applyRewrite('# comment\n\nreplace "#with space" "#changed space"', "https://example.com/#with space"))
    .toEqual({ ok: true, url: "https://example.com/#changed space" });
});

it("feeds each replacement into later filters and replacements, including capture groups", () => {
  const source = String.raw`replace "/article/(\\d+)" "/reader/$1"
filter "/reader/"
replace "[?#].*$" ""`;
  expect(applyRewrite(source, REWRITE_EXAMPLE_URL)).toEqual({ ok: true, url: "https://example.com/reader/123" });
  expect(applyRewrite('replace "a" "b"', "https://example.com/aaa")).toEqual({ ok: true, url: "https://exbmple.com/aaa" });
});

it("discards intermediate URLs when a later filter or exclusion stops the update", () => {
  expect(applyRewrite('replace "/old" "/new"\nfilter "/different"', "https://example.com/old"))
    .toEqual({ ok: true, url: null, line: 2 });
  expect(applyRewrite('replace "/old" "/private"\nexclude "/private"', "https://example.com/old"))
    .toEqual({ ok: true, url: null, line: 2 });
  expect(applyRewrite("# comments only", REWRITE_EXAMPLE_URL)).toEqual({ ok: true, url: null });
});

it.each([
  'replace "[" "x"',
  'replace "x"',
  'filter "x" "y"',
  'eval "alert(1)"',
  'replace "\\q" "x"',
  'replace "x" "y" // comment',
])("reports the original line for invalid commands without partially applying them (%s)", line => {
  const source = `# comment\n\nreplace "/old" "/new"\n${line}`;
  expect(validateRewrite(source)).toContain("Line 4:");
  expect(applyRewrite(source, "https://example.com/old")).toEqual({ ok: false, error: expect.stringContaining("Line 4:") });
});
