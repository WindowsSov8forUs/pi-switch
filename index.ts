import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Account, SelectorItem, SwitchConfig } from "./types.ts";
import { ensureConfig } from "./store.ts";
import { simpleSelect, searchSelect, promptAccount } from "./selectors.ts";
import { activateAccount, syncActiveCredentials } from "./activate.ts";
import { handleModelsCommand } from "./models.ts";
import { handleReloadCommand } from "./reload.ts";

// ---------------------------------------------------------------------------
// Provider item builders (only providers with saved accounts)
// ---------------------------------------------------------------------------

function getBuiltinProviderItems(ctx: ExtensionContext, cfg: SwitchConfig): SelectorItem[] {
  const registry = ctx.modelRegistry.getAll();
  const knownIds = new Set(registry.map((m) => m.provider));
  const items: SelectorItem[] = [];
  for (const [key, accounts] of Object.entries(cfg.providers)) {
    if (key.startsWith("custom:")) continue;
    if (!accounts || accounts.length === 0) continue;
    if (!knownIds.has(key)) continue;
    const provider = ctx.modelRegistry.getProvider(key);
    items.push({ label: provider?.name ?? key, value: key });
  }
  items.sort((a, b) => a.label.localeCompare(b.label));
  return items;
}

function getAdditionalProviderItems(cfg: SwitchConfig): SelectorItem[] {
  const items: SelectorItem[] = [];
  for (const [key, accounts] of Object.entries(cfg.providers)) {
    if (!key.startsWith("custom:")) continue;
    if (!accounts || accounts.length === 0) continue;
    items.push({ label: key.slice(7), value: key });
  }
  items.sort((a, b) => a.label.localeCompare(b.label));
  return items;
}

// ---------------------------------------------------------------------------
// /switch — activate a saved account
// ---------------------------------------------------------------------------

async function handleSwitchCommand(ctx: ExtensionContext, pi: ExtensionAPI) {
  const self = {
    ctx,
    pi,
    cfg: await ensureConfig(),

    async showProviderTypeSelector(): Promise<void> {
      const typeChoice = await simpleSelect(this.ctx, "Select provider type", [
        "Built-in Provider",
        "Additional Provider",
      ]);
      if (!typeChoice) return;

      const isBuiltin = typeChoice === "Built-in Provider";
      const items = isBuiltin
        ? getBuiltinProviderItems(this.ctx, this.cfg)
        : getAdditionalProviderItems(this.cfg);

      if (items.length === 0) {
        const label = isBuiltin ? "built-in provider" : "additional provider";
        this.ctx.ui.notify(`No ${label} accounts saved. Use /switch models to add one.`, "info");
        return this.showProviderTypeSelector();
      }
      return this.showProviderSelector(items);
    },

    async showProviderSelector(items: SelectorItem[]): Promise<void> {
      const key = await searchSelect(this.ctx, "Select provider", items);
      if (!key) return this.showProviderTypeSelector();

      const accounts = this.cfg.providers[key] ?? [];
      if (accounts.length === 0) {
        this.ctx.ui.notify("No accounts for this provider.", "info");
        return this.showProviderSelector(items);
      }
      return this.showAccountSelector(key, accounts, items);
    },

    async showAccountSelector(key: string, accounts: Account[], items: SelectorItem[]): Promise<void> {
      const accountId = await promptAccount(this.ctx, key, accounts, {
        activeId: this.cfg.active[key],
      });
      if (!accountId) return this.showProviderSelector(items);

      const account = accounts.find((a) => a.id === accountId);
      if (account) await activateAccount(this.ctx, this.pi, key, account);
    },
  };

  await self.showProviderTypeSelector();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const SWITCH_SUBCOMMANDS = ["models", "reload"];

export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", async (_event, ctx) => {
    await syncActiveCredentials(ctx);
  });

  pi.registerCommand("switch", {
    description: "Switch the active account of an existing provider. /switch models — manage accounts. /switch reload — import from auth.json + models.json.",
    getArgumentCompletions: (prefix) =>
      SWITCH_SUBCOMMANDS.filter((v) => v.startsWith(prefix.trim())).map((v) => ({ value: v, label: v })),
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") { ctx.ui.notify("/switch requires interactive TUI mode", "error"); return; }
      const sub = args?.trim();
      if (sub === "models") { await handleModelsCommand(ctx, pi); return; }
      if (sub === "reload") { await handleReloadCommand(ctx); return; }
      await handleSwitchCommand(ctx, pi);
    },
  });
}
