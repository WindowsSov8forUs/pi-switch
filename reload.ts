import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Credential, ProviderConfig } from "./types.ts";
import { deepEqual, ensureConfig, saveAccount, saveConfig } from "./store.ts";

// ---------------------------------------------------------------------------
// /switch reload — import accounts from Pi's existing config
//
// Sources:
//   auth.json   → provider id → credential (api_key / oauth)
//   models.json → custom providers (ProviderConfig snapshots) → "custom:<id>"
//
// Skipped:
//   - auth.json entries that are not api_key / oauth shaped
//   - models.json entries missing baseUrl or models (pure built-in overrides)
//   - accounts whose data deep-equals an existing account (dedup)
// ---------------------------------------------------------------------------

export async function handleReloadCommand(ctx: ExtensionContext): Promise<void> {
  const cfg = await ensureConfig();
  let imported = 0;
  let skipped = 0;

  // auth.json — provider id → credential
  const authPath = join(homedir(), ".pi", "agent", "auth.json");
  try {
    const authData = JSON.parse(await readFile(authPath, "utf-8")) as Record<string, Credential>;
    for (const [providerId, cred] of Object.entries(authData)) {
      if (!cred || typeof cred !== "object") continue;
      if (cred.type !== "api_key" && cred.type !== "oauth") continue;
      const existing = cfg.providers[providerId] ?? [];
      if (existing.some((a) => deepEqual(a.data, cred))) {
        skipped++;
        continue;
      }
      saveAccount(providerId, providerId, "", cred);
      imported++;
    }
  } catch {
    // missing auth.json is fine
  }

  // models.json — custom providers (ProviderConfig snapshots)
  const modelsPath = join(homedir(), ".pi", "agent", "models.json");
  try {
    const modelsData = JSON.parse(await readFile(modelsPath, "utf-8")) as {
      providers?: Record<string, ProviderConfig>;
    };
    for (const [providerId, blob] of Object.entries(modelsData.providers ?? {})) {
      if (!blob || typeof blob !== "object" || !blob.baseUrl || !blob.models) continue;
      const key = "custom:" + providerId;
      const existing = cfg.providers[key] ?? [];
      if (existing.some((a) => deepEqual(a.data, blob))) {
        skipped++;
        continue;
      }
      saveAccount(key, providerId, "", blob);
      imported++;
    }
  } catch {
    // missing models.json is fine
  }

  await saveConfig();
  ctx.ui.notify(
    `Imported ${imported} account(s)${skipped > 0 ? `, skipped ${skipped} duplicate(s)` : ""}.`,
    "info",
  );
}
