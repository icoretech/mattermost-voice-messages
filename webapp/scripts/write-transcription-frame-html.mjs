import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const webappDir = resolve(scriptsDir, "..");
const manifest = JSON.parse(
  await readFile(resolve(webappDir, "..", "plugin.json"), "utf8"),
);
const template = await readFile(
  resolve(webappDir, "public", "transcription-frame.html"),
  "utf8",
);
const html = template.replaceAll(
  "__TRANSCRIPTION_FRAME_VERSION__",
  encodeURIComponent(String(manifest.version)),
);

await mkdir(resolve(webappDir, "dist"), { recursive: true });
await writeFile(resolve(webappDir, "dist", "transcription-frame.html"), html);
