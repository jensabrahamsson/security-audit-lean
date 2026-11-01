#!/usr/bin/env node
"use strict";
/*
 * inventory.cjs - Phase 0 inventory for security-audit-lean. Reads only git metadata
 * (file names), never file contents. Part of security-audit-lean
 * (derived from cloudflare/security-audit-skill @ c1c8a8c, MIT).
 *   node inventory.cjs <target-repo>
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const target = process.argv[2] || ".";
function git(args) { return execFileSync("git", ["-C", target, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }); }
const head = git(["rev-parse", "HEAD"]).trim();
const top = git(["rev-parse", "--show-toplevel"]).trim();
const dirty = git(["status", "--porcelain"]).split("\n").filter(Boolean).length;
const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);

const EXCL = [
  ["secret_or_env", /(^|\/)(secrets[^/]*\.ya?ml|\.env(\.[^/]*)?|[^/]*\.env|[^/]*\.(pem|key|p12|pfx)|id_(rsa|ed25519)[^/]*)$/i],
  ["test", /(^|\/)(tests?|__tests__|spec|specs|testdata|fixtures?|e2e|cypress|playwright)(\/|$)|(\.|_)(test|spec)\.[a-z0-9]+$|(^|\/)test_[^/]+\.py$|_test\.go$/i],
  ["docs", /(^|\/)(docs?|documentation|examples?|samples?)(\/|$)|\.(md|mdx|rst|adoc|txt)$/i],
  ["generated_or_vendor", /(^|\/)(vendor|third_party|node_modules|dist|build|out|target|\.next|coverage|generated|gen|__generated__)(\/|$)|\.(min\.js|map|pb\.go|g\.dart)$|_pb2\.py$/i],
  ["lockfile", /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|uv\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/],
  ["binary_or_asset", /\.(png|jpe?g|gif|svg|ico|webp|pdf|zip|gz|tgz|jar|woff2?|ttf|eot|mp4|mp3|wasm|so|dylib|dll|exe)$/i],
];
const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|requirements[^/]*\.txt|setup\.py|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?|[^/]*\.csproj|Gemfile|composer\.json|Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|[^/]*\.tf|Chart\.yaml|serverless\.ya?ml|wrangler\.toml|\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.yml|Makefile)$/;

const excl = {}; const kept = []; const manifests = [];
for (const f of files) {
  if (MANIFEST.test(f) && !/(^|\/)(node_modules|vendor)\//.test(f)) manifests.push(f);
  const hit = EXCL.find(([, re]) => re.test(f));
  if (hit) { (excl[hit[0]] = excl[hit[0]] || []).push(f); continue; }
  kept.push(f);
}
const count = (arr, keyFn) => { const m = {}; for (const x of arr) { const k = keyFn(x); m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]); };
const topDirs = count(kept, (f) => (f.includes("/") ? f.split("/")[0] + "/" : "(root)"));
const second = count(kept, (f) => f.split("/").slice(0, 2).join("/") + (f.split("/").length > 2 ? "/" : ""));
const exts = count(kept, (f) => path.extname(f).toLowerCase() || "(none)");
const globsOf = (arr) => { const g = count(arr, (f) => { const p = f.split("/"); return p.length > 2 ? p.slice(0, 2).join("/") + "/**" : f; }); return g.slice(0, 15).map(([k, v]) => `${k} (${v})`); };

const out = [];
out.push(`repo: ${path.basename(top)}  commit: ${head}  dirty_entries: ${dirty}`);
out.push(`tracked files: ${files.length}  in-scope candidates: ${kept.length}`);
out.push(`\n## top-level dirs (in-scope candidates)`); for (const [k, v] of topDirs.slice(0, 30)) out.push(`${v}\t${k}`);
out.push(`\n## second level (top 40)`); for (const [k, v] of second.slice(0, 40)) out.push(`${v}\t${k}`);
out.push(`\n## extensions (top 25)`); out.push(exts.slice(0, 25).map(([k, v]) => `${k}:${v}`).join("  "));
out.push(`\n## manifests / deploy / CI (${manifests.length}, first 60)`); for (const m of manifests.slice(0, 60)) out.push(m);
out.push(`\n## excluded by default (log in scope-log.md)`);
for (const [k] of EXCL) { const a = excl[k] || []; out.push(`${k}: ${a.length}${a.length ? "  e.g. " + globsOf(a).join(", ") : ""}`); }
process.stdout.write(out.join("\n") + "\n");
