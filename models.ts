import type { ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Account, Credential, SelectorItem } from "./types.ts";
import { LoginDialogComponent, ExtensionSelectorComponent } from "@earendil-works/pi-coding-agent";
import { ensureConfig, saveConfig, saveAccount, removeAccount } from "./store.ts";
import { simpleSelect, searchSelect, promptAccount, promptInput } from "./selectors.ts";

/** Built-in provider IDs — from pi-ai builtinProviders(). */
const BUILTIN_IDS = new Set([
  "amazon-bedrock", "ant-ling", "anthropic", "azure-openai-responses",
  "cerebras", "cloudflare-ai-gateway", "cloudflare-workers-ai", "deepseek",
  "fireworks", "github-copilot", "google", "google-vertex", "groq",
  "huggingface", "kimi-coding", "minimax", "minimax-cn", "mistral",
  "moonshotai", "moonshotai-cn", "nvidia", "openai", "openai-codex",
  "opencode", "opencode-go", "openrouter", "qwen-token-plan",
  "qwen-token-plan-cn", "radius", "together", "vercel-ai-gateway",
  "xai", "xiaomi", "xiaomi-token-plan-ams", "xiaomi-token-plan-cn",
  "xiaomi-token-plan-sgp", "zai", "zai-coding-cn",
]);

const ADD_ACCOUNT_VALUE = "__pi_switch_add_account__";

// ---------------------------------------------------------------------------
// /switch models — main flow
// ---------------------------------------------------------------------------

export async function handleModelsCommand(ctx: ExtensionContext, pi: ExtensionAPI) {
  const self = {
    ctx,
    pi,
    cfg: await ensureConfig(),

    /** Select provider type. */
    async showProviderTypeSelector(): Promise<void> {
      const choice = await simpleSelect(this.ctx, "Select provider type", [
        "Built-in Provider",
        "Additional Provider",
      ]);
      if (!choice) return;

      if (choice === "Built-in Provider") {
        return this.showBuiltinProviderList();
      } else {
        return this.showAdditionalProviderList();
      }
    },

    /** List all built-in providers with status. */
    async showBuiltinProviderList(): Promise<void> {
      const registry = this.ctx.modelRegistry.getAll();
      const providerIds = [...new Set(registry.map((m) => m.provider))]
        .filter((pid) => BUILTIN_IDS.has(pid))
        .sort();

      const items: SelectorItem[] = [];
      for (const pid of providerIds) {
        const provider = this.ctx.modelRegistry.getProvider(pid);
        const name = provider?.name ?? pid;
        const count = (this.cfg.providers[pid] ?? []).length;
        items.push({
          label: name,
          inlineSuffix: `  (${count})`,
          inlineSuffixColor: count > 0 ? "success" : "muted",
          value: pid,
        });
      }

      if (items.length === 0) {
        this.ctx.ui.notify("No built-in providers found.", "error");
        return this.showProviderTypeSelector();
      }

      const key = await searchSelect(this.ctx, "Select provider", items);
      if (!key) return this.showProviderTypeSelector();

      return this.showAccountList(key);
    },

    /** List additional (custom) providers. */
    async showAdditionalProviderList(): Promise<void> {
      const items: SelectorItem[] = [];
      for (const [key, accounts] of Object.entries(this.cfg.providers)) {
        if (!key.startsWith("custom:")) continue;
        const count = (accounts ?? []).length;
        items.push({
          label: key.slice(7),
          inlineSuffix: `  (${count})`,
          inlineSuffixColor: count > 0 ? "success" : "muted",
          value: key,
        });
      }
      items.sort((a, b) => a.label.localeCompare(b.label));

      if (items.length === 0) {
        this.ctx.ui.notify(
          "No custom providers configured. Add them manually to ~/.pi/agent/pi-switch.json — see README.",
          "info",
        );
        return this.showProviderTypeSelector();
      }

      const key = await searchSelect(this.ctx, "Select provider", items);
      if (!key) return this.showProviderTypeSelector();

      return this.showAccountList(key);
    },

    /** Account list; "Add account..." is only offered for built-in providers —
     *  custom provider accounts are configured manually in pi-switch.json. */
    async showAccountList(key: string): Promise<void> {
      const accounts = this.cfg.providers[key] ?? [];
      const isCustom = key.startsWith("custom:");

      const accountId = await promptAccount(this.ctx, key, accounts, {
        pinned: isCustom ? undefined : { label: "Add account...", value: ADD_ACCOUNT_VALUE },
      });
      if (!accountId) return this.showProviderTypeSelector();

      if (accountId === ADD_ACCOUNT_VALUE) {
        return this.addAccount(key);
      }

      const account = accounts.find((a) => a.id === accountId);
      if (!account) return this.showAccountList(key);

      return this.showAccountActions(key, account);
    },

    // -----------------------------------------------------------------------
    // Add account (built-in providers only; custom provider accounts are
    // configured manually in ~/.pi/agent/pi-switch.json)
    // -----------------------------------------------------------------------

    async addAccount(key: string): Promise<void> {
      const provider = this.ctx.modelRegistry.getProvider(key);
      if (!provider) {
        this.ctx.ui.notify(`Provider "${key}" not available.`, "error");
        return this.showAccountList(key);
      }

      // Choose auth type
      const hasOAuth = provider.auth?.oauth?.login !== undefined;
      const hasApiKey = provider.auth?.apiKey?.login !== undefined;
      if (!hasOAuth && !hasApiKey) {
        this.ctx.ui.notify(`No login method available for "${key}".`, "error");
        return this.showAccountList(key);
      }

      let authType: "oauth" | "api_key" = "api_key";
      if (hasOAuth && hasApiKey) {
        const oauthLabel = provider.auth?.oauth?.loginLabel ?? "Sign in with an account";
        const choice = await simpleSelect(this.ctx, "Select authentication method", [
          oauthLabel,
          "Sign in with an API key",
        ]);
        if (!choice) return this.showAccountList(key);
        authType = choice !== "Sign in with an API key" ? "oauth" : "api_key";
      } else if (hasOAuth) {
        authType = "oauth";
      }

      const cred = await this.runLoginFlow(provider, key, authType);
      if (!cred) return this.showAccountList(key);

      const name = await promptInput(this.ctx, "Account name", provider.name ?? key);
      if (name === null) return this.showAccountList(key);
      const notes = await promptInput(this.ctx, "Notes (optional)", "");
      if (notes === null) return this.showAccountList(key);

      saveAccount(key, name, notes, cred);
      await saveConfig();
      this.ctx.ui.notify(`Account "${name}" saved.`, "info");
      return this.showAccountList(key);
    },

    /** Login via LoginDialogComponent — exact copy of /login flow. */
    async runLoginFlow(provider: any, key: string, authType: "oauth" | "api_key"): Promise<Credential | null> {
      const method = authType === "oauth" ? provider.auth?.oauth : provider.auth?.apiKey;
      if (!method?.login) {
        this.ctx.ui.notify("No login method available.", "error");
        return null;
      }

      return await new Promise<Credential | null>((resolvePromise) => {
        this.ctx.ui.custom<void>((tui, _theme, _kb, done) => {
          const providerName = provider.name ?? key;
          const dialog = new LoginDialogComponent(tui, key, () => {}, providerName,
            `Login to ${providerName}`);

          // Copy of InteractiveMode.showAuthPrompt (incl. prompt.signal abort race)
          const showAuthPrompt = async (dialog_: any, prompt_: any): Promise<string> => {
            let response: Promise<string>;
            if (prompt_.type === "select") {
              // Copy of InteractiveMode.showAuthSelect. pi's original swaps the
              // editor container (clear + addChild + setFocus); inside ctx.ui.custom
              // we can't touch the editor container, so mount the selector INTO the
              // dialog's content container instead (still rendered + focusable).
              response = new Promise((resolveSelect, rejectSelect) => {
                const labels = prompt_.options.map((o: any) => o.label);
                const restoreDialog = () => {
                  dialog_.contentContainer.clear();
                  tui.setFocus(dialog_);
                  tui.requestRender();
                };
                const selector = new ExtensionSelectorComponent(
                  prompt_.message, labels,
                  (label: string) => {
                    restoreDialog();
                    const id = prompt_.options.find((o: any) => o.label === label)?.id;
                    if (id) resolveSelect(id);
                    else rejectSelect(new Error("Login cancelled"));
                  },
                  () => {
                    restoreDialog();
                    rejectSelect(new Error("Login cancelled"));
                  },
                );
                dialog_.contentContainer.clear();
                dialog_.contentContainer.addChild(selector);
                tui.setFocus(selector);
                tui.requestRender();
              });
            } else if (prompt_.type === "manual_code") {
              response = dialog_.showManualInput(prompt_.message);
            } else {
              response = dialog_.showPrompt(prompt_.message, prompt_.placeholder);
            }
            if (!prompt_.signal) return response;
            if (prompt_.signal.aborted) throw new Error("Login cancelled");
            const signal: AbortSignal = prompt_.signal;
            let onAbort: (() => void) | undefined;
            const aborted = new Promise<never>((_resolve, reject) => {
              onAbort = () => reject(new Error("Login cancelled"));
              signal.addEventListener("abort", onAbort, { once: true });
            });
            try {
              return await Promise.race([response, aborted]);
            } finally {
              if (onAbort) signal.removeEventListener("abort", onAbort);
            }
          };

          // Copy of InteractiveMode.notifyAuthDialog
          const notifyAuthDialog = (dialog_: any, event: any) => {
            if (event.type === "auth_url") {
              dialog_.showAuth(event.url, event.instructions);
            } else if (event.type === "device_code") {
              dialog_.showDeviceCode(event);
              dialog_.showWaiting("Waiting for authentication...");
            } else if (event.type === "info") {
              dialog_.showInfo(event.message, event.links);
            } else {
              dialog_.showProgress(event.message);
            }
          };

          // Run login (copy of InteractiveMode.loginProvider)
          const runLogin = async () => {
            try {
              const cred_ = await method.login({
                signal: dialog.signal,
                prompt: (p: any) => showAuthPrompt(dialog, p),
                notify: (e: any) => notifyAuthDialog(dialog, e),
              });
              done();
              resolvePromise(cred_);
            } catch (err: any) {
              done();
              resolvePromise(null);
              if (err.message !== "Login cancelled") {
                this.ctx.ui.notify(`Login failed: ${err.message}`, "error");
              }
            }
          };

          runLogin();
          return dialog;
        });
      });
    },

    // -----------------------------------------------------------------------
    // Edit / delete
    // -----------------------------------------------------------------------

    /** Select existing account → edit or delete. */
    async showAccountActions(key: string, account: Account): Promise<void> {
      const choice = await simpleSelect(this.ctx, account.name, [
        "Edit account",
        "Delete account",
      ]);
      if (!choice) return this.showAccountList(key);

      if (choice === "Edit account") {
        await this.editAccount(key, account);
      } else {
        await this.deleteAccount(key, account);
      }
    },

    async editAccount(key: string, account: Account): Promise<void> {
      const name = await promptInput(this.ctx, "Name", account.name);
      if (name === null) return this.showAccountList(key);
      const notes = await promptInput(this.ctx, "Notes", account.notes);
      if (notes === null) return this.showAccountList(key);
      account.name = name;
      account.notes = notes;
      await saveConfig();
      this.ctx.ui.notify(`"${account.name}" updated.`, "info");
      return this.showAccountList(key);
    },

    async deleteAccount(key: string, account: Account): Promise<void> {
      const ok = await this.ctx.ui.confirm(
        "Delete account",
        `Delete "${account.name}"?\n\nThis cannot be undone.`,
      );
      if (!ok) return this.showAccountList(key);
      removeAccount(key, account.id);
      await saveConfig();
      this.ctx.ui.notify(`"${account.name}" deleted.`, "info");
      return this.showAccountList(key);
    },

  };

  await self.showProviderTypeSelector();
}

