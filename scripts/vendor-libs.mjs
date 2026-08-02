// Copies the browser runtime libraries into frontend/vendor/ so the app can boot with
// no network. Anything imported from a CDN at run time would be unavailable offline:
// sw.js can cache cross-origin responses, but a module import that misses the cache
// takes the whole page down, so the entry points are served from our own origin.
//
// Model weights are deliberately not vendored. They are hundreds of megabytes, they
// live in Cache Storage after the in-app "Download for offline use" step, and the ONNX
// Runtime .wasm binaries are fetched once and cached the same way.
import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const vendorDir = path.resolve(scriptDir, "../frontend/vendor");

// Keep these in step with the versions the frontend expects:
// - frontend/asr/worker.js pins ORT_VERSION for the matching .wasm binary
// - frontend/sw.js precaches the file names below
export const TRANSFORMERS_VERSION = "4.2.0";
export const ORT_VERSION = "1.26.0";

const FILES = [
  {
    // The bundled browser build, i.e. exactly what the CDN served for the bare
    // "@huggingface/transformers" specifier. It carries its own ONNX Runtime.
    file: "transformers.min.js",
    url: `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/dist/transformers.min.js`,
  },
  {
    file: "ort.webgpu.min.mjs",
    url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.webgpu.min.mjs`,
  },
  {
    // The Emscripten glue ort.webgpu loads at session creation. It must stay paired
    // with the .wasm of the same version that asr/worker.js downloads and caches.
    file: "ort-wasm-simd-threaded.asyncify.mjs",
    url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.asyncify.mjs`,
  },
];

async function fileSize(target) {
  try {
    return (await stat(target)).size;
  } catch {
    return null;
  }
}

async function download({ file, url }, { force }) {
  const target = path.join(vendorDir, file);
  const existing = await fileSize(target);
  if (existing && !force) {
    console.log(`skip  ${file} (${existing} bytes already vendored)`);
    return;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(target, bytes);
  console.log(`saved ${file} (${bytes.length} bytes)`);
}

async function main() {
  const force = process.argv.includes("--force");
  await mkdir(vendorDir, { recursive: true });
  for (const entry of FILES) {
    await download(entry, { force });
  }
  console.log(`vendor directory: ${vendorDir}`);
}

await main();
