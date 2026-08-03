import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Account, Credential, ProviderConfig, SwitchConfig } from "./types.ts";
import {
  clearActiveAccount,
  deepEqual,
  ensureConfig,
  saveConfig,
  setActiveAccount,
} from "./store.ts";

const MODELS_PATH = join(homedir(), ".pi", "agent", "models.json");

type RuntimeCredentials = {
  read(providerId: string): Promise<Credential | undefined>;
  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined>;
  hasRuntimeApiKey?(providerId: string): boolean;
  removeRuntimeApiKey?(providerId: string): void;
};

type SwitchableModelRuntime = {
  credentials: RuntimeCredentials;
  refresh(options?: { allowNetwork?: boolean }): Promise<unknown>;
};

/**
 * Pi does not currently expose credential mutation on ExtensionContext. The
 * ModelRegistry facade nevertheless owns the canonical ModelRuntime instance;
 * using its RuntimeCredentials store is important because it updates both the
 * in-memory credential snapshot and auth.json under Pi's normal file lock.
 */
function getModelRuntime(ctx: ExtensionContext): SwitchableModelRuntime {
  const runtime = (ctx.modelRegistry as unknown as { runtime?: SwitchableModelRuntime }).runtime;
  if (!runtime?.credentials?.modify || !runtime.refresh) {
    throw new Error("This Pi version does not expose a switchable credential runtime.");
  }
  return runtime;
}

function cloneCredential(credential: Credential): Credential {
  return structuredClone(credential);
}

function isCredential(value: unknown): value is Credential {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "api_key" || type === "oauth";
}

async function refreshCredentialBeforeSwitch(
  ctx: ExtensionContext,
  providerId: string,
  credential: Credential,
): Promise<Credential> {
  if (credential.type !== "oauth") return cloneCredential(credential);

  // OpenAI can invalidate a Codex access token before its JWT/stored expiry.
  // Always exchange the refresh token when explicitly switching accounts so
  // quota widgets and the next model request never observe that stale token.
  const expiresSoon = Date.now() + 5 * 60 * 1000 >= credential.expires;
  if (providerId !== "openai-codex" && !expiresSoon) return cloneCredential(credential);

  const oauth = ctx.modelRegistry.getProvider(providerId)?.auth.oauth;
  if (!oauth) throw new Error(`Provider "${providerId}" has no OAuth refresh method.`);

  try {
    return structuredClone(await oauth.refresh(structuredClone(credential), ctx.signal)) as Credential;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `OAuth refresh failed for "${providerId}": ${message}. Re-add this account with /switch models.`,
    );
  }
}

/**
 * OAuth refresh may rotate access and refresh tokens in auth.json. Before an
 * account is replaced (and at shutdown), copy those refreshed tokens back to
 * the selected pi-switch account. A stable accountId prevents a native /login
 * from accidentally being mistaken for a token refresh.
 */
async function syncActiveCredential(
  ctx: ExtensionContext,
  cfg: SwitchConfig,
  key: string,
): Promise<boolean> {
  if (key.startsWith("custom:")) return false;
  const activeId = cfg.active[key];
  if (!activeId) return false;

  const account = cfg.providers[key]?.find((candidate) => candidate.id === activeId);
  if (!account || !isCredential(account.data)) {
    clearActiveAccount(key);
    return true;
  }

  const saved = account.data;
  const current = await getModelRuntime(ctx).credentials.read(key);
  if (!current || current.type !== saved.type) {
    clearActiveAccount(key);
    return true;
  }

  if (current.type === "api_key") {
    // API keys do not rotate. RuntimeCredentials resolves $ENV references on
    // read, so comparing it with the saved raw value would produce a false
    // mismatch and incorrectly clear the active marker.
    return false;
  }

  if (saved.type !== "oauth") {
    clearActiveAccount(key);
    return true;
  }
  const savedAccountId = saved.accountId;
  const currentAccountId = current.accountId;
  if (savedAccountId && currentAccountId && savedAccountId !== currentAccountId) {
    clearActiveAccount(key);
    return true;
  }
  if (deepEqual(current, saved)) return false;

  account.data = cloneCredential(current);
  return true;
}

/** Persist refreshed OAuth tokens for all accounts activated by pi-switch. */
export async function syncActiveCredentials(ctx: ExtensionContext): Promise<void> {
  const cfg = await ensureConfig();
  let changed = false;
  for (const key of Object.keys(cfg.active)) {
    try {
      changed = (await syncActiveCredential(ctx, cfg, key)) || changed;
    } catch {
      // Shutdown/reload must not fail because a stale runtime is already gone.
    }
  }
  if (changed) await saveConfig();
}

async function writeCustomProvider(providerId: string, config: ProviderConfig): Promise<void> {
  let document: { providers?: Record<string, unknown>; [key: string]: unknown } = {};
  try {
    document = JSON.parse(await readFile(MODELS_PATH, "utf-8"));
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      throw new Error(`Cannot read models.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  document.providers ??= {};
  document.providers[providerId] = structuredClone(config);
  await mkdir(join(homedir(), ".pi", "agent"), { recursive: true });
  await writeFile(MODELS_PATH, JSON.stringify(document, null, 2), "utf-8");
}

async function refreshCurrentModelReference(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  providerId: string,
): Promise<void> {
  const current = ctx.model;
  if (!current || current.provider !== providerId) return;

  const replacement = ctx.modelRegistry.find(providerId, current.id);
  if (!replacement) {
    ctx.ui.notify(
      `Account switched, but model "${current.id}" is not available from "${providerId}". Use /model to select one.`,
      "warning",
    );
    return;
  }

  if (!(await pi.setModel(replacement))) {
    ctx.ui.notify(`Account switched, but Pi could not rebind ${providerId}/${current.id}.`, "warning");
  }
}

async function activateBuiltinAccount(
  ctx: ExtensionContext,
  key: string,
  account: Account,
): Promise<void> {
  if (!isCredential(account.data)) {
    throw new Error(`Saved account "${account.name}" is not a Pi credential.`);
  }

  const cfg = await ensureConfig();
  if (await syncActiveCredential(ctx, cfg, key)) await saveConfig();

  const runtime = getModelRuntime(ctx);
  const credential = await refreshCredentialBeforeSwitch(ctx, key, account.data);

  if (runtime.credentials.hasRuntimeApiKey?.(key)) {
    runtime.credentials.removeRuntimeApiKey?.(key);
  }
  await runtime.credentials.modify(key, async () => credential);
  await runtime.refresh({ allowNetwork: false });

  // Save a rotated refresh token immediately; waiting for shutdown would make
  // this account unusable after an abrupt process exit. Resolve by ID instead
  // of relying on the command's Account object sharing the store reference.
  const storedAccount = cfg.providers[key]?.find((candidate) => candidate.id === account.id);
  if (!storedAccount) throw new Error(`Saved account "${account.name}" no longer exists.`);
  storedAccount.data = cloneCredential(credential);
  account.data = cloneCredential(credential);
  setActiveAccount(key, account.id);
  await saveConfig();
  ctx.ui.notify(`Switched ${key} to "${account.name}". Current model unchanged.`, "info");
}

async function activateCustomAccount(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  key: string,
  account: Account,
): Promise<void> {
  const providerId = key.slice("custom:".length);
  const config = account.data as ProviderConfig;
  if (!providerId || !config?.baseUrl || !config.api) {
    throw new Error("Custom provider account is missing provider id, baseUrl, or api.");
  }

  await writeCustomProvider(providerId, config);
  await ctx.modelRegistry.refresh();

  setActiveAccount(key, account.id);
  await saveConfig();
  await refreshCurrentModelReference(ctx, pi, providerId);
  ctx.ui.notify(`Switched ${providerId} to "${account.name}". Current model unchanged.`, "info");
}

// ---------------------------------------------------------------------------
// Switch the original provider account (does not create a temporary provider)
// ---------------------------------------------------------------------------

export async function activateAccount(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  key: string,
  account: Account,
): Promise<void> {
  try {
    if (key.startsWith("custom:")) {
      await activateCustomAccount(ctx, pi, key, account);
    } else {
      await activateBuiltinAccount(ctx, key, account);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Switch failed: ${message}`, "error");
  }
}
