// Compile TS/TSX for node:test without adding a runtime loader dependency.
// Run: node artifacts/judges-seat/tests/run.mjs
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";

const requireApi = createRequire(new URL("../../api-server/package.json", import.meta.url));
const { build } = requireApi("esbuild");
const cache = fileURLToPath(new URL("../node_modules/.cache/", import.meta.url));
await mkdir(cache, { recursive: true });
const output = await mkdtemp(join(cache, "synchronization-"));
try {
  const entries = ["synchronization.test.mjs", "sharing-failures.test.mjs"];
  await build({
    entryPoints: entries.map(file => fileURLToPath(new URL(`./${file}`, import.meta.url))),
    outdir: output, outExtension: { ".js": ".mjs" },
    bundle: true, platform: "node", format: "esm", packages: "external",
    define: { "import.meta.env.BASE_URL": '"/"' },
    tsconfig: fileURLToPath(new URL("./tsconfig.json", import.meta.url)),
    alias: { "@workspace/api-client-react": fileURLToPath(new URL("../../../lib/api-client-react/src/index.ts", import.meta.url)) },
  });
  const child = spawn(process.execPath, ["--test", ...entries.map(file => join(output, file))], { stdio: "inherit" });
  const [code] = await once(child, "exit");
  process.exitCode = code ?? 1;
} finally { await rm(output, { recursive: true, force: true }); }
