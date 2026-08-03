import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Account, Credential, ProviderConfig, SwitchConfig } from "./types.ts";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-switch.json");
// ---------------------------------------------------------------------------
// Config CRUD
// ---------------------------------------------------------------------------

let _config: SwitchConfig | null = null;

export async function ensureConfig(): Promise<SwitchConfig> {
  if (_config) return _config;
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    _config = {
      version: 1,
      providers: parsed.providers ?? {},
      active: parsed.active ?? {},
    };
  } catch { _config = { version: 1, providers: {}, active: {} }; }
  return _config;
}

export async function saveConfig() {
  if (!_config) return;
  await mkdir(join(homedir(), ".pi", "agent"), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(_config, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

export function isCredential(d: Credential | ProviderConfig): d is Credential {
  return (d as Credential).type === "api_key" || (d as Credential).type === "oauth";
}

// ---------------------------------------------------------------------------
// Account CRUD
// ---------------------------------------------------------------------------

export function saveAccount(key: string, name: string, notes: string, data: Credential | ProviderConfig): Account {
  const cfg = _config!;
  const account: Account = { id: slugify(name) + "-" + Date.now().toString(36), name, notes, data };
  (cfg.providers[key] ??= []).push(account);
  return account;
}

export function removeAccount(key: string, accountId: string) {
  const cfg = _config!;
  const list = cfg.providers[key];
  if (!list) return;
  const idx = list.findIndex((a) => a.id === accountId);
  if (idx >= 0) list.splice(idx, 1);
  if (list.length === 0) delete cfg.providers[key];
  if (cfg.active[key] === accountId) delete cfg.active[key];
}

export function setActiveAccount(key: string, accountId: string): void {
  _config!.active[key] = accountId;
}

export function clearActiveAccount(key: string): void {
  delete _config!.active[key];
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export type FlatEntry = { key: string; account: Account };

export function flatList(): FlatEntry[] {
  const cfg = _config!;
  const result: FlatEntry[] = [];
  for (const [key, accounts] of Object.entries(cfg.providers)) {
    for (const account of accounts ?? []) result.push({ key, account });
  }
  return result;
}

export function displayLine(key: string, a: Account): string {
  const tag = key.startsWith("custom:") ? key.slice(7) : key;
  let line = `${a.name}  [${tag}]`;
  if (a.notes) line += ` — ${a.notes}`;
  return line;
}

// ---------------------------------------------------------------------------
// deepEqual (dedup)
// ---------------------------------------------------------------------------

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (Array.isArray(a) || Array.isArray(b)) return false;
  const keysA = Object.keys(a as object).sort();
  const keysB = Object.keys(b as object).sort();
  if (keysA.length !== keysB.length) return false;
  if (!keysA.every((k, i) => k === keysB[i])) return false;
  return keysA.every((k) => deepEqual((a as any)[k], (b as any)[k]));
}
