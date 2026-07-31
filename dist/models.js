import { LoginDialogComponent, ExtensionSelectorComponent } from "@earendil-works/pi-coding-agent";
import { ensureConfig, saveConfig, saveAccount, removeAccount } from "./store.js";
import { simpleSelect, searchSelect, promptAccount } from "./selectors.js";
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
export async function handleModelsCommand(ctx, pi) {
    const self = {
        ctx,
        pi,
        cfg: await ensureConfig(),
        /** Select provider type. */
        async showProviderTypeSelector() {
            const choice = await simpleSelect(this.ctx, "Select provider type", [
                "Built-in Provider",
                "Additional Provider",
            ]);
            if (!choice)
                return;
            if (choice === "Built-in Provider") {
                return this.showBuiltinProviderList();
            }
            else {
                return this.showAdditionalProviderList();
            }
        },
        /** List all built-in providers with status. */
        async showBuiltinProviderList() {
            const registry = this.ctx.modelRegistry.getAll();
            const providerIds = [...new Set(registry.map((m) => m.provider))]
                .filter((pid) => BUILTIN_IDS.has(pid))
                .sort();
            const items = [];
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
            if (!key)
                return this.showProviderTypeSelector();
            return this.showAccountList(key);
        },
        /** List additional (custom) providers. */
        async showAdditionalProviderList() {
            const items = [];
            for (const [key, accounts] of Object.entries(this.cfg.providers)) {
                if (!key.startsWith("custom:"))
                    continue;
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
                this.ctx.ui.notify("No custom providers configured. Add them manually to ~/.pi/agent/pi-switch.json — see README.", "info");
                return this.showProviderTypeSelector();
            }
            const key = await searchSelect(this.ctx, "Select provider", items);
            if (!key)
                return this.showProviderTypeSelector();
            return this.showAccountList(key);
        },
        /** Account list; "Add account..." is only offered for built-in providers —
         *  custom provider accounts are configured manually in pi-switch.json. */
        async showAccountList(key) {
            const accounts = this.cfg.providers[key] ?? [];
            const isCustom = key.startsWith("custom:");
            const accountId = await promptAccount(this.ctx, key, accounts, {
                pinned: isCustom ? undefined : { label: "Add account...", value: ADD_ACCOUNT_VALUE },
            });
            if (!accountId)
                return this.showProviderTypeSelector();
            if (accountId === ADD_ACCOUNT_VALUE) {
                return this.addAccount(key);
            }
            const account = accounts.find((a) => a.id === accountId);
            if (!account)
                return this.showAccountList(key);
            return this.showAccountActions(key, account);
        },
        // -----------------------------------------------------------------------
        // Add account (built-in providers only; custom provider accounts are
        // configured manually in ~/.pi/agent/pi-switch.json)
        // -----------------------------------------------------------------------
        async addAccount(key) {
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
            let authType = "api_key";
            if (hasOAuth && hasApiKey) {
                const oauthLabel = provider.auth?.oauth?.loginLabel ?? "Sign in with an account";
                const choice = await simpleSelect(this.ctx, "Select authentication method", [
                    oauthLabel,
                    "Sign in with an API key",
                ]);
                if (!choice)
                    return this.showAccountList(key);
                authType = choice !== "Sign in with an API key" ? "oauth" : "api_key";
            }
            else if (hasOAuth) {
                authType = "oauth";
            }
            const cred = await this.runLoginFlow(provider, key, authType);
            if (!cred)
                return this.showAccountList(key);
            const name = await this.ctx.ui.input("Account name", provider.name ?? key);
            if (name === undefined)
                return this.showAccountList(key);
            const notes = await this.ctx.ui.input("Notes (optional)", "");
            if (notes === undefined)
                return this.showAccountList(key);
            saveAccount(key, name, notes, cred);
            await saveConfig();
            this.ctx.ui.notify(`Account "${name}" saved.`, "info");
            return this.showAccountList(key);
        },
        /** Login via LoginDialogComponent — exact copy of /login flow. */
        async runLoginFlow(provider, key, authType) {
            const method = authType === "oauth" ? provider.auth?.oauth : provider.auth?.apiKey;
            if (!method?.login) {
                this.ctx.ui.notify("No login method available.", "error");
                return null;
            }
            return await new Promise((resolvePromise) => {
                this.ctx.ui.custom((tui, _theme, _kb, done) => {
                    const providerName = provider.name ?? key;
                    const dialog = new LoginDialogComponent(tui, key, () => { }, providerName, `Login to ${providerName}`);
                    // Copy of InteractiveMode.showAuthPrompt
                    const showAuthPrompt = (dialog_, prompt_) => {
                        if (prompt_.type === "select") {
                            // Copy of InteractiveMode.showAuthSelect
                            return new Promise((resolveSelect, rejectSelect) => {
                                const labels = prompt_.options.map((o) => o.label);
                                const selector = new ExtensionSelectorComponent(prompt_.message, labels, (label) => {
                                    const id = prompt_.options.find((o) => o.label === label)?.id;
                                    if (id)
                                        resolveSelect(id);
                                    else
                                        rejectSelect(new Error("Login cancelled"));
                                }, () => rejectSelect(new Error("Login cancelled")));
                                tui.setFocus(selector);
                                dialog_._selectorOverride = selector;
                                tui.requestRender();
                            });
                        }
                        if (prompt_.type === "manual_code") {
                            return dialog_.showManualInput(prompt_.message);
                        }
                        return dialog_.showPrompt(prompt_.message, prompt_.placeholder);
                    };
                    // Copy of InteractiveMode.notifyAuthDialog
                    const notifyAuthDialog = (dialog_, event) => {
                        if (event.type === "auth_url") {
                            dialog_.showAuth(event.url, event.instructions);
                        }
                        else if (event.type === "device_code") {
                            dialog_.showDeviceCode(event);
                            dialog_.showWaiting("Waiting for authentication...");
                        }
                        else if (event.type === "info") {
                            dialog_.showInfo(event.message, event.links);
                        }
                        else {
                            dialog_.showProgress(event.message);
                        }
                    };
                    // Run login (copy of InteractiveMode.loginProvider)
                    const runLogin = async () => {
                        try {
                            const cred_ = await method.login({
                                signal: dialog.signal,
                                prompt: (p) => showAuthPrompt(dialog, p),
                                notify: (e) => notifyAuthDialog(dialog, e),
                            });
                            done();
                            resolvePromise(cred_);
                        }
                        catch (err) {
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
        async showAccountActions(key, account) {
            const choice = await simpleSelect(this.ctx, account.name, [
                "Edit account",
                "Delete account",
            ]);
            if (!choice)
                return this.showAccountList(key);
            if (choice === "Edit account") {
                await this.editAccount(key, account);
            }
            else {
                await this.deleteAccount(key, account);
            }
        },
        async editAccount(key, account) {
            const name = await this.ctx.ui.input("Name", account.name);
            if (name === undefined)
                return this.showAccountList(key);
            const notes = await this.ctx.ui.input("Notes", account.notes);
            if (notes === undefined)
                return this.showAccountList(key);
            account.name = name;
            account.notes = notes;
            await saveConfig();
            this.ctx.ui.notify(`"${account.name}" updated.`, "info");
            return this.showAccountList(key);
        },
        async deleteAccount(key, account) {
            const ok = await this.ctx.ui.confirm("Delete account", `Delete "${account.name}"?\n\nThis cannot be undone.`);
            if (!ok)
                return this.showAccountList(key);
            removeAccount(key, account.id);
            await saveConfig();
            this.ctx.ui.notify(`"${account.name}" deleted.`, "info");
            return this.showAccountList(key);
        },
    };
    await self.showProviderTypeSelector();
}
