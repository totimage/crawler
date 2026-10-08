// Bundles src/ into public/bundle.js and copies the pdf.js worker.
// `node build.mjs --serve` serves public/ on :3100 and proxies /api to the local Flask app on :5056.
import * as esbuild from "esbuild";
import { copyFileSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

process.chdir(dirname(fileURLToPath(import.meta.url)));

copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.js", "public/pdf.worker.min.js");

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: "public/bundle.js",
  tsconfig: "tsconfig.json",
  logLevel: "info",
  absWorkingDir: process.cwd(),
};

if (process.argv.includes("--serve")) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: "public", port: 3101 });
  http.createServer((req, res) => {
    const api = req.url.startsWith("/api/");
    const target = api ? { port: 5056 } : { port };
    const proxy = http.request({ hostname: "127.0.0.1", ...target, path: req.url, method: req.method, headers: req.headers },
      (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    proxy.on("error", () => { res.writeHead(502); res.end(api ? "Start the API: python api/search.py" : "dev server error"); });
    req.pipe(proxy);
  }).listen(3100, () => console.log("Dev server: http://localhost:3100"));
} else {
  await esbuild.build(options);
}
