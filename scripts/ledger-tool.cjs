#!/usr/bin/env node
"use strict";
/*
 * ledger-tool.cjs - deterministic ledger bookkeeping for security-audit-lean.
 * Part of security-audit-lean (derived from cloudflare/security-audit-skill @ c1c8a8c, MIT).
 * Keeps the parent from hand-writing verbose ledger JSON. Output stays compatible
 * with validate-coverage-ledger.cjs (run it after every command).
 *
 *   node ledger-tool.cjs seed   <spec.json> <ledger.json>        create ledger (refuses to overwrite)
 *   node ledger-tool.cjs add    <spec.json> <ledger.json>        append units (e.g. critic gaps, uncovered)
 *   node ledger-tool.cjs assign <ledger.json> <agent-id> <coverage_id|@subsystem-ref>...
 *   node ledger-tool.cjs apply  <ledger.json> <hunter-result.json>
 *   node ledger-tool.cjs defer  <ledger.json> <reason>            planned/in_progress -> deferred
 *   node ledger-tool.cjs verdicts <ledger.json> <verifier-result.json>...
 *   node ledger-tool.cjs findings <out-findings.json> <verifier-result.json>...
 *   node ledger-tool.cjs summary <ledger.json>
 *
 * spec.json: {"units":[{"surface","surface_ref","boundary","boundary_ref","subsystem",
 *   "subsystem_ref","attack_class","attack_class_ref","starting_paths":[],
 *   "ordinary_attack_class_block":null|"ATTACK-CLASSES.md#...","selected_companion_blocks":[],
 *   "excluded_blocks":[{"block","reason"}],"status":"planned|out_of_scope|deferred|not_applicable",
 *   "reason":"required unless planned","prior_status":"none", "lifecycle"?, "lifecycle_ref"?}]}
 */
const fs = require("node:fs");
const path = require("node:path");

function die(msg) { process.stderr.write(`ledger-tool: ${msg}\n`); process.exit(1); }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { die(`cannot read ${p}: ${e.message}`); } }
function writeJson(p, v) { fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n"); }
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FP_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;

function enc(ref, label) {
  if (typeof ref !== "string" || ref.length === 0) die(`missing canonical ref: ${label}`);
  if (ref !== ref.normalize("NFC")) die(`ref not NFC: ${label}`);
  if (ref !== ref.trim()) die(`ref has surrounding whitespace: ${label}`);
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(ref)) die(`ref has control/format char: ${label}`);
  const bytes = Buffer.from(ref, "utf8");
  let out = "";
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    out += /[A-Za-z0-9\-._~]/.test(c) ? c : "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

function buildUnit(s) {
  const refs = { surface: s.surface_ref, boundary: s.boundary_ref, subsystem: s.subsystem_ref, attack_class: s.attack_class_ref };
  const parts = [enc(refs.surface, "surface_ref"), enc(refs.boundary, "boundary_ref"), enc(refs.subsystem, "subsystem_ref"), enc(refs.attack_class, "attack_class_ref")];
  if (s.lifecycle_ref) { refs.lifecycle = s.lifecycle_ref; parts.push(enc(s.lifecycle_ref, "lifecycle_ref")); }
  if (!Array.isArray(s.starting_paths) || s.starting_paths.length === 0) die(`starting_paths must be a nonempty array (${s.surface})`);
  const status = s.status || "planned";
  if (!["planned", "out_of_scope", "deferred", "not_applicable"].includes(status)) die(`seed status not allowed: ${status}`);
  if (status !== "planned" && !s.reason) die(`status ${status} needs reason (${s.surface})`);
  const u = {
    coverage_id: parts.join("::"),
    canonical_refs: refs,
    surface: s.surface, boundary: s.boundary, subsystem: s.subsystem, attack_class: s.attack_class,
  };
  if (s.lifecycle_ref) u.lifecycle = s.lifecycle || s.lifecycle_ref;
  Object.assign(u, {
    starting_paths: s.starting_paths || [],
    ordinary_attack_class_block: s.ordinary_attack_class_block === undefined ? null : s.ordinary_attack_class_block,
    selected_companion_blocks: s.selected_companion_blocks || [],
    excluded_blocks: s.excluded_blocks || [],
    prior_status: s.prior_status || "none",
    attempts: [], wave: 1, status, agent_id: null,
    reviewed_paths: [], local_checks: [], result_fingerprints: [],
    unresolved: status === "planned" ? [] : [String(s.reason)],
  });
  return u;
}

function sortAndCheck(units) {
  units.sort((a, b) => (a.coverage_id < b.coverage_id ? -1 : a.coverage_id > b.coverage_id ? 1 : 0));
  for (let i = 1; i < units.length; i++) if (units[i].coverage_id === units[i - 1].coverage_id) die(`duplicate coverage_id: ${units[i].coverage_id}`);
  return units;
}

function union(checks) { return [...new Set(checks.flatMap((c) => c.reviewed_paths || []))].sort(); }

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "seed":
  case "add": {
    const [specP, ledgerP] = args; if (!specP || !ledgerP) die("usage: seed|add <spec.json> <ledger.json>");
    const spec = readJson(specP); if (!Array.isArray(spec.units)) die("spec.units must be an array");
    let units = [];
    if (cmd === "seed") { if (fs.existsSync(ledgerP)) die(`${ledgerP} exists; use add`); }
    else units = readJson(ledgerP);
    units.push(...spec.units.map(buildUnit));
    writeJson(ledgerP, sortAndCheck(units));
    console.log(`${cmd}: ${spec.units.length} unit(s); ledger now ${units.length}`);
    break;
  }
  case "assign": {
    const [ledgerP, agent, ...sel] = args; if (!ID_RE.test(agent || "")) die("agent id must match ^[a-z0-9][a-z0-9_-]{0,63}$");
    const units = readJson(ledgerP); let n = 0;
    for (const u of units) {
      const hit = sel.some((s) => (s.startsWith("@") ? u.canonical_refs.subsystem === s.slice(1) : u.coverage_id === s));
      if (!hit) continue;
      if (u.status !== "planned") die(`unit not planned: ${u.coverage_id} (${u.status})`);
      u.status = "in_progress"; u.agent_id = agent; n++;
    }
    writeJson(ledgerP, units); console.log(`assigned ${n} unit(s) to ${agent}`);
    break;
  }
  case "apply": {
    const [ledgerP, resP] = args; const units = readJson(ledgerP); const res = readJson(resP);
    const byId = new Map(units.map((u) => [u.coverage_id, u])); let n = 0;
    for (const r of res.units || []) {
      const u = byId.get(r.coverage_id); if (!u) die(`unknown coverage_id in result: ${r.coverage_id}`);
      if (u.status !== "in_progress") die(`unit not in_progress: ${r.coverage_id}`);
      if (!["covered", "candidate", "blocked"].includes(r.disposition)) die(`bad disposition ${r.disposition}`);
      const checks = (r.checks || []).map((c) => ({ ...c, agent_id: c.agent_id || u.agent_id, artifact: c.method === "local" ? c.artifact : null }));
      u.status = r.disposition; u.local_checks = checks; u.reviewed_paths = union(checks);
      u.result_fingerprints = r.disposition === "candidate" ? (r.candidate_fingerprints || []) : [];
      u.unresolved = r.disposition === "covered" ? [] : (r.unresolved || []);
      n++;
    }
    const seen = new Set((res.units || []).map((r) => r.coverage_id));
    const owner = res.agent_id || ((res.units || [])[0] && byId.get(res.units[0].coverage_id).agent_id);
    const missing = units.filter((u) => u.status === "in_progress" && u.agent_id === owner && !seen.has(u.coverage_id));
    for (const u of missing) { u.status = "deferred"; u.agent_id = null; u.unresolved = ["assigned hunter returned no disposition (lean: deferred)"]; }
    writeJson(ledgerP, units);
    console.log(`applied ${n} unit result(s); ${missing.length} assigned unit(s) without result -> deferred; candidates=${(res.candidates || []).length} uncovered=${(res.uncovered || []).length}`);
    break;
  }
  case "defer": {
    const [ledgerP, ...reason] = args; const units = readJson(ledgerP); const why = reason.join(" ") || "lean budget/cap reached";
    let n = 0;
    for (const u of units) if (u.status === "planned" || u.status === "in_progress") {
      Object.assign(u, { status: "deferred", agent_id: null, reviewed_paths: [], local_checks: [], result_fingerprints: [], unresolved: [why] }); n++;
    }
    writeJson(ledgerP, units); console.log(`deferred ${n} unit(s)`);
    break;
  }
  case "verdicts": {
    const [ledgerP, ...files] = args; const units = readJson(ledgerP); let n = 0;
    for (const f of files) for (const d of readJson(f).decisions || []) {
      const fp = d.record && d.record.fingerprint; if (!fp) continue;
      for (const u of units) if ((u.result_fingerprints || []).includes(fp)) {
        u.verification = u.verification || {}; u.verification[fp] = { decision: d.decision, verifier: readJson(f).agent_id || path.basename(path.dirname(f)) }; n++;
      }
    }
    writeJson(ledgerP, units); console.log(`recorded ${n} verdict link(s)`);
    break;
  }
  case "findings": {
    const [outP, ...files] = args; if (!outP || !files.length) die("usage: findings <out.json> <verifier-result.json>...");
    const recs = new Map();
    for (const f of files) for (const d of readJson(f).decisions || []) {
      if (!["confirmed", "needs_validation", "rejected"].includes(d.decision)) die(`bad decision in ${f}`);
      const r = { verdict: d.decision, ...d.record }; r.verdict = d.decision;
      for (const k of ["proposed_verdict", "priority_hint", "coverage_ids", "agent_id"]) delete r[k];
      if (!FP_RE.test(r.fingerprint || "")) die(`bad fingerprint in ${f}`);
      if (recs.has(r.fingerprint)) die(`duplicate fingerprint ${r.fingerprint}; merge decisions first`);
      recs.set(r.fingerprint, r);
    }
    const out = [...recs.values()].sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1));
    writeJson(outP, out); console.log(`wrote ${out.length} record(s) to ${outP}`);
    break;
  }
  case "summary": {
    const units = readJson(args[0]); const c = {};
    for (const u of units) c[u.status] = (c[u.status] || 0) + 1;
    const fps = new Set(units.flatMap((u) => u.result_fingerprints || []));
    console.log(JSON.stringify({ units: units.length, by_status: c, candidate_fingerprints: [...fps].sort() }));
    break;
  }
  default:
    die("unknown command; see header");
}
