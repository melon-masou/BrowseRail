import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function loadIconAssets() {
  const assets = {};
  const source = fileURLToPath(new URL("./assets/icons/", import.meta.url));
  for (const name of await readdir(source)) assets[`icons/${name}`] = await readFile(resolve(source, name));
  const lucide = dirname(fileURLToPath(import.meta.resolve("lucide-static/package.json")));
  const nodes = JSON.parse(await readFile(resolve(lucide, "icon-nodes.json"), "utf8"));
  const files = (await readdir(resolve(lucide, "icons"))).filter(name => name.endsWith(".svg")).sort();
  const bodies = await Promise.all(files.map(async name => {
    const svg = await readFile(resolve(lucide, "icons", name), "utf8");
    const body = svg.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/)?.[1].trim();
    if (!body) throw new Error(`Invalid Lucide SVG: ${name}`);
    return [name.slice(0, -4), body];
  }));
  // The node catalog omits aliases; match their SVG geometry to canonical names.
  const names = new Map(bodies.filter(([name]) => Object.hasOwn(nodes, name)).map(([name, body]) => [body, name]));
  const aliases = {};
  for (const [name, body] of bodies) {
    if (Object.hasOwn(nodes, name)) continue;
    const canonical = names.get(body);
    if (!canonical) throw new Error(`Unresolved Lucide alias: ${name}`);
    aliases[name] = canonical;
  }
  assets["icons/lucide/icons.json"] = JSON.stringify({ icons: nodes, aliases });
  assets["icons/lucide/tags.json"] = await readFile(resolve(lucide, "tags.json"));
  assets["icons/lucide/LICENSE"] = await readFile(resolve(lucide, "LICENSE"));

  const phosphor = resolve(dirname(fileURLToPath(import.meta.resolve("@phosphor-icons/core"))), "..");
  const phosphorFiles = (await readdir(resolve(phosphor, "assets/fill"))).filter(name => name.endsWith("-fill.svg")).sort();
  const icons = Object.fromEntries(await Promise.all(phosphorFiles.map(async name => {
    const svg = await readFile(resolve(phosphor, "assets/fill", name), "utf8");
    const body = svg.match(/<svg\b[^>]*viewBox="0 0 256 256"[^>]*>([\s\S]*?)<\/svg>/)?.[1].trim();
    if (!body) throw new Error(`Invalid Phosphor SVG: ${name}`);
    return [name.slice(0, -"-fill.svg".length), body];
  })));
  assets["icons/phosphor/icons.json"] = JSON.stringify({ icons });
  assets["icons/phosphor/LICENSE"] = await readFile(resolve(phosphor, "LICENSE"));
  const { icons: metadata } = await import("@phosphor-icons/core");
  assets["icons/phosphor/tags.json"] = JSON.stringify(Object.fromEntries(metadata
    .filter(icon => Object.hasOwn(icons, icon.name))
    .map(icon => [icon.name, icon.tags.filter(tag => !tag.startsWith("*"))])));
  return assets;
}
