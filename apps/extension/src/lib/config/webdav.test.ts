import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EXPORT_SCHEMA_VERSION } from "@browserail/protocol";

const permission = vi.hoisted(() => vi.fn(async () => true));
vi.mock("webextension-polyfill", () => ({ default: { permissions: { request: permission } } }));
import { authorizeWebDav, readWebDavSettings, uploadWebDavSettings } from "./webdav";

let server: Server;
let url: string;
let contents: string | undefined;
let failure = 0;
let requests: Array<{ method: string; authorization: string | undefined }>;
const data = { version: EXPORT_SCHEMA_VERSION, exportedAt: "2026-10-09T00:00:00Z", menus: [] };

beforeEach(async () => {
  permission.mockReset().mockResolvedValue(true);
  contents = undefined; failure = 0; requests = [];
  server = createServer(async (request, response) => {
    requests.push({ method: request.method!, authorization: request.headers.authorization });
    if (failure) { response.writeHead(failure); response.end("unavailable"); return; }
    if (request.method === "PUT") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      contents = Buffer.concat(chunks).toString();
      response.writeHead(201); response.end();
    } else if (contents === undefined) {
      response.writeHead(404); response.end();
    } else {
      response.setHeader("Content-Type", "application/json"); response.end(contents);
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing HTTP address");
  url = `http://127.0.0.1:${address.port}/browserail.json`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

it("creates a missing WebDAV file and reads its configuration with UTF-8 Basic authentication", async () => {
  const settings = { url, username: "alice", password: "test-密码" };
  await authorizeWebDav(settings);
  const signal = new AbortController().signal;
  expect(await readWebDavSettings(settings, signal)).toBeUndefined();
  await uploadWebDavSettings(settings, data, signal);
  expect(await readWebDavSettings(settings, signal)).toEqual(data);
  expect(permission).toHaveBeenCalledWith({ origins: ["http://127.0.0.1/*"] });
  expect(requests.map(request => request.method)).toEqual(["GET", "PUT", "GET"]);
  for (const request of requests) expect(Buffer.from(request.authorization!.slice(6), "base64").toString()).toBe("alice:test-密码");
});

it("rejects server failures and malformed configuration instead of treating them as an empty file", async () => {
  const settings = { url, username: "", password: "" };
  failure = 401;
  await expect(readWebDavSettings(settings, new AbortController().signal)).rejects.toThrow("HTTP 401");
  failure = 0; contents = "not JSON";
  await expect(readWebDavSettings(settings, new AbortController().signal)).rejects.toThrow();
  contents = JSON.stringify({ version: 99, menus: [] });
  await expect(readWebDavSettings(settings, new AbortController().signal)).rejects.toThrow();
  expect(requests.every(request => request.method === "GET")).toBe(true);
});

it("rejects unsupported URLs and denied permission before contacting the server", async () => {
  for (const invalid of ["file:///test", "https://alice:password@example.com/file", "https://example.com/file#fragment", "not a URL"]) {
    await expect(authorizeWebDav({ url: invalid, username: "", password: "" })).rejects.toThrow();
  }
  expect(permission).not.toHaveBeenCalled();
  permission.mockResolvedValue(false);
  await expect(authorizeWebDav({ url, username: "", password: "" })).rejects.toThrow("not granted");
  expect(requests).toEqual([]);
});

it("does not send cancelled uploads", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(uploadWebDavSettings({ url, username: "", password: "" }, data, controller.signal)).rejects.toThrow();
  expect(contents).toBeUndefined();
});
