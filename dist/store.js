import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
export const CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-switch.json");
export const PROVIDER_PREFIX = "pi-switch";
// ---------------------------------------------------------------------------
// Config CRUD
// ---------------------------------------------------------------------------
let _config = null;
export async function ensureConfig() {
    if (_config)
        return _config;
    try {
        const raw = await readFile(CONFIG_PATH, "utf-8");
        const parsed = JSON.parse(raw);
        _config = { version: 1, providers: parsed.providers ?? {} };
    }
    catch {
        _config = { version: 1, providers: {} };
    }
    return _config;
}
export async function saveConfig() {
    if (!_config)
        return;
    await mkdir(join(homedir(), ".pi", "agent"), { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify(_config, null, 2), "utf-8");
}
// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------
export function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}
export function providerId(key, accountId) {
    return `${PROVIDER_PREFIX}:${key}:${accountId}`;
}
// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------
export function isCredential(d) {
    return d.type === "api_key" || d.type === "oauth";
}
// ---------------------------------------------------------------------------
// Account CRUD
// ---------------------------------------------------------------------------
export function saveAccount(key, name, notes, data) {
    const cfg = _config;
    const account = { id: slugify(name) + "-" + Date.now().toString(36), name, notes, data };
    (cfg.providers[key] ??= []).push(account);
    return account;
}
export function removeAccount(key, accountId) {
    const list = _config.providers[key];
    if (!list)
        return;
    const idx = list.findIndex((a) => a.id === accountId);
    if (idx >= 0)
        list.splice(idx, 1);
    if (list.length === 0)
        delete _config.providers[key];
}
export function flatList() {
    const cfg = _config;
    const result = [];
    for (const [key, accounts] of Object.entries(cfg.providers)) {
        for (const account of accounts ?? [])
            result.push({ key, account });
    }
    return result;
}
export function displayLine(key, a) {
    const tag = key.startsWith("custom:") ? key.slice(7) : key;
    let line = `${a.name}  [${tag}]`;
    if (a.notes)
        line += ` — ${a.notes}`;
    return line;
}
// ---------------------------------------------------------------------------
// deepEqual (dedup)
// ---------------------------------------------------------------------------
export function deepEqual(a, b) {
    if (a === b)
        return true;
    if (typeof a !== typeof b)
        return false;
    if (typeof a !== "object" || a === null || b === null)
        return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length)
            return false;
        return a.every((item, i) => deepEqual(item, b[i]));
    }
    if (Array.isArray(a) || Array.isArray(b))
        return false;
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length)
        return false;
    if (!keysA.every((k, i) => k === keysB[i]))
        return false;
    return keysA.every((k) => deepEqual(a[k], b[k]));
}
