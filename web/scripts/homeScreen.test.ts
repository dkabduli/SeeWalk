// @vitest-environment node
// Home-screen app (docs/prd/home-screen-app.md): the tags, the manifest and every icon it points to.
// Fails if someone drops a tag, deletes an icon, or regenerates one at the wrong size.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const web = fileURLToPath(new URL("..", import.meta.url));
const pub = (path: string) => resolve(web, "public", path.replace(/^\//, ""));
const html = readFileSync(resolve(web, "index.html"), "utf8");
// index.html writes every tag on one line as name/rel first, then content/href
const tags = (tag: string) => html.match(new RegExp(`<${tag}\\b[^>]*>`, "g")) ?? [];
const attr = (el: string, name: string) => el.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const meta = (name: string) => attr(tags("meta").find((m) => attr(m, "name") === name) ?? "", "content");
const links = (rel: string) => tags("link").filter((l) => attr(l, "rel") === rel);
const link = (rel: string) => attr(links(rel)[0] ?? "", "href");
const manifest = JSON.parse(readFileSync(pub(link("manifest") ?? "missing"), "utf8"));

/** Width and height from a PNG's header. */
function pngSize(path: string): [number, number] {
  const b = readFileSync(pub(path));
  expect(b.subarray(1, 4).toString()).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const DARK = "#0f1113";

describe("home-screen app", () => {
  it("opens full screen on iPhone, under a see-through status bar, named Companion", () => {
    expect(meta("apple-mobile-web-app-capable")).toBe("yes");
    expect(meta("apple-mobile-web-app-status-bar-style")).toBe("black-translucent");
    expect(meta("apple-mobile-web-app-title")).toBe("Companion");
    expect("Companion".length).toBeLessThanOrEqual(12); // iPhone cuts longer names under the icon
    expect(meta("viewport")).toContain("viewport-fit=cover"); // else env(safe-area-inset-*) is 0
  });

  it("is dark from the first frame: theme colour and page background", () => {
    expect(meta("theme-color")).toBe(DARK);
    expect(attr(tags("html")[0] ?? "", "style")).toContain(DARK);
    expect(manifest.theme_color).toBe(DARK);
    expect(manifest.background_color).toBe(DARK);
  });

  it("manifest: standalone, short name fits, starts at the walk screen", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.short_name).toBe(meta("apple-mobile-web-app-title"));
    expect(manifest.name).toBe("VisionCompanion");
    expect(manifest.start_url).toBe("/");
  });

  it("the iPhone icon is 180 px", () => {
    expect(pngSize(link("apple-touch-icon")!)).toEqual([180, 180]);
  });

  it("every manifest icon exists at its stated size, with a maskable one for Android", () => {
    for (const icon of manifest.icons as { src: string; sizes: string }[]) {
      const [w, h] = icon.sizes.split("x").map(Number);
      expect(pngSize(icon.src), icon.src).toEqual([w, h]);
    }
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  });

  it("every icon the page links to exists", () => {
    const icons = [...links("icon"), ...links("apple-touch-icon")];
    expect(icons.length).toBeGreaterThanOrEqual(3);
    for (const el of icons) {
      const href = attr(el, "href")!;
      expect(existsSync(pub(href)), href).toBe(true);
    }
  });
});
