import { LoginDialogComponent, ExtensionSelectorComponent } from "@earendil-works/pi-coding-agent";
import { ensureConfig, saveConfig, saveAccount, removeAccount, slugify } from "./store.js";
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
const ADD_PROVIDER_VALUE = "__pi_switch_add_provider__";
const API_OPTIONS = [
    "openai-completions", "openai-responses", "anthropic-messages",
    "google-generative-ai", "mistral-conversations",
];
/** Map ProviderModelDef[] → registerProvider models input. */
function modelsInput(models = [], fallbackBaseUrl) {
    return models.map((m) => ({
        id: m.id, name: m.name, reasoning: m.reasoning, input: m.input,
        contextWindow: m.contextWindow, maxTokens: m.maxTokens, cost: m.cost,
        api: m.api, baseUrl: m.baseUrl ?? fallbackBaseUrl,
        headers: m.headers, thinkingLevelMap: m.thinkingLevelMap, compat: m.compat,
    }));
}
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
                this.ctx.ui.notify("No additional providers configured. Use Add provider... first.", "info");
                return this.showProviderTypeSelector();
            }
            const key = await searchSelect(this.ctx, "Select provider", items, {
                pinned: { label: "Add provider...", value: ADD_PROVIDER_VALUE },
            });
            if (!key)
                return this.showProviderTypeSelector();
            if (key === ADD_PROVIDER_VALUE)
                return this.addProvider();
            return this.showAccountList(key);
        },
        /** Account list with pinned "Add account..." for both builtin and custom. */
        async showAccountList(key) {
            const accounts = this.cfg.providers[key] ?? [];
            const accountId = await promptAccount(this.ctx, key, accounts, {
                pinned: { label: "Add account...", value: ADD_ACCOUNT_VALUE },
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
        // Add custom provider
        // -----------------------------------------------------------------------
        async addProvider() {
            const slug = await this.ctx.ui.input("Provider slug (e.g. my-llm)", "");
            if (!slug)
                return this.showAdditionalProviderList();
            const key = "custom:" + slugify(slug);
            if ((this.cfg.providers[key] ?? []).length > 0) {
                this.ctx.ui.notify(`Provider "${slug}" already exists.`, "warning");
                return this.showAdditionalProviderList();
            }
            const name = await this.ctx.ui.input("Account name", slug);
            if (name === undefined)
                return this.showAdditionalProviderList();
            const notes = await this.ctx.ui.input("Notes (optional)", "");
            if (notes === undefined)
                return this.showAdditionalProviderList();
            const def = await this.promptProviderDefinition();
            if (!def)
                return this.showAdditionalProviderList();
            // Temp-register to get composed apiKey auth, run login flow for first key
            const tempId = "pi-switch-add-" + Date.now().toString(36);
            this.pi.registerProvider(tempId, {
                name: name,
                baseUrl: def.baseUrl, api: def.api,
                models: modelsInput(def.models, def.baseUrl),
            });
            const provider = this.ctx.modelRegistry.getProvider(tempId);
            const cred = provider?.auth?.apiKey
                ? await this.runLoginFlow(provider, tempId, "api_key")
                : null;
            this.pi.unregisterProvider(tempId);
            if (!cred || cred.type !== "api_key")
                return this.showAdditionalProviderList();
            const blob = {
                name,
                baseUrl: def.baseUrl,
                api: def.api,
                apiKey: cred.key,
                models: def.models,
            };
            saveAccount(key, name, notes, blob);
            await saveConfig();
            this.ctx.ui.notify(`Provider "${slug}" added.`, "info");
            return this.showAdditionalProviderList();
        },
        /** Prompt provider definition (baseUrl/api/models), with optional key hint for auto-fetch. */
        async promptProviderDefinition(hint) {
            const baseUrl = await this.ctx.ui.input("Base URL", hint?.baseUrl ?? "https://api.example.com/v1");
            if (!baseUrl)
                return null;
            const apiChoice = await simpleSelect(this.ctx, "API type", [...API_OPTIONS]);
            if (!apiChoice)
                return null;
            const api = apiChoice;
            const models = [];
            const autoFetch = await this.ctx.ui.confirm("Auto-fetch models?", `Fetch from ${baseUrl}/models?`);
            if (autoFetch) {
                try {
                    const fetched = await fetchModels(baseUrl, hint?.apiKey ?? "");
                    if (fetched.length > 0) {
                        models.push(...fetched);
                        this.ctx.ui.notify(`Fetched ${fetched.length} model(s).`, "info");
                    }
                    else {
                        this.ctx.ui.notify("No models returned.", "warning");
                    }
                }
                catch (err) {
                    this.ctx.ui.notify(`Fetch failed: ${err.message}`, "error");
                }
            }
            if (models.length === 0) {
                const define = await this.ctx.ui.confirm("Define models manually?", "No models fetched. Define manually?");
                if (define)
                    await this.manualModelEntry(models);
            }
            return { baseUrl, api, models };
        },
        // -----------------------------------------------------------------------
        // Add account (builtin or custom)
        // -----------------------------------------------------------------------
        async addAccount(key) {
            const isCustom = key.startsWith("custom:");
            const accounts = this.cfg.providers[key] ?? [];
            const hintBlob = isCustom ? accounts[0]?.data : undefined;
            let provider;
            let tempId;
            if (isCustom) {
                if (!hintBlob?.baseUrl || !hintBlob.api) {
                    this.ctx.ui.notify("Provider definition missing baseUrl or api.", "error");
                    return this.showAccountList(key);
                }
                // Temp-register to get composed apiKey auth
                tempId = "pi-switch-add-" + Date.now().toString(36);
                this.pi.registerProvider(tempId, {
                    name: hintBlob.name,
                    baseUrl: hintBlob.baseUrl, api: hintBlob.api,
                    apiKey: hintBlob.apiKey,
                    headers: hintBlob.headers, authHeader: hintBlob.authHeader,
                    models: modelsInput(hintBlob.models, hintBlob.baseUrl),
                });
                provider = this.ctx.modelRegistry.getProvider(tempId);
            }
            else {
                provider = this.ctx.modelRegistry.getProvider(key);
            }
            if (!provider) {
                if (tempId)
                    this.pi.unregisterProvider(tempId);
                this.ctx.ui.notify(`Provider "${key}" not available.`, "error");
                return this.showAccountList(key);
            }
            // Choose auth type (custom → api_key only)
            const hasOAuth = provider.auth?.oauth?.login !== undefined;
            const hasApiKey = provider.auth?.apiKey?.login !== undefined;
            if (!hasOAuth && !hasApiKey) {
                if (tempId)
                    this.pi.unregisterProvider(tempId);
                this.ctx.ui.notify(`No login method available for "${key}".`, "error");
                return this.showAccountList(key);
            }
            let authType = "api_key";
            if (hasOAuth && hasApiKey) {
                const oauthLabel = provider.auth.oauth.loginLabel ?? "Sign in with an account";
                const choice = await simpleSelect(this.ctx, "Select authentication method", [
                    oauthLabel,
                    "Sign in with an API key",
                ]);
                if (!choice) {
                    if (tempId)
                        this.pi.unregisterProvider(tempId);
                    return this.showAccountList(key);
                }
                authType = choice !== "Sign in with an API key" ? "oauth" : "api_key";
            }
            else if (hasOAuth) {
                authType = "oauth";
            }
            const cred = await this.runLoginFlow(provider, key, authType);
            if (tempId)
                this.pi.unregisterProvider(tempId);
            if (!cred)
                return this.showAccountList(key);
            // Name + notes
            const displayName = isCustom
                ? (hintBlob?.name ?? key.slice(7))
                : (provider.name ?? key);
            const name = await this.ctx.ui.input("Account name", displayName);
            if (name === undefined)
                return this.showAccountList(key);
            const notes = await this.ctx.ui.input("Notes (optional)", "");
            if (notes === undefined)
                return this.showAccountList(key);
            if (isCustom && cred.type === "api_key") {
                // Merge new key into provider definition
                const newBlob = { ...hintBlob, apiKey: cred.key };
                saveAccount(key, name, notes, newBlob);
            }
            else {
                saveAccount(key, name, notes, cred);
            }
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
        // -----------------------------------------------------------------------
        // Model entry helpers
        // -----------------------------------------------------------------------
        async manualModelEntry(models) {
            let more = true;
            while (more) {
                const modelId = await this.ctx.ui.input("Model ID (e.g. gpt-4o)", "");
                if (!modelId)
                    break;
                const modelName = (await this.ctx.ui.input("Model name", modelId)) ?? modelId;
                const reasoning = await this.ctx.ui.confirm("Supports reasoning/thinking?", "");
                const hasImages = await this.ctx.ui.confirm("Supports image input?", "");
                const ctxWin = parseInt((await this.ctx.ui.input("Context window (tokens)", "128000")) ?? "128000", 10) || 128000;
                const maxTok = parseInt((await this.ctx.ui.input("Max output tokens", "16384")) ?? "16384", 10) || 16384;
                models.push({
                    id: modelId, name: modelName, reasoning,
                    input: hasImages ? ["text", "image"] : ["text"],
                    contextWindow: ctxWin, maxTokens: maxTok,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                });
                more = (await this.ctx.ui.confirm("Add another model?", "")) ?? false;
            }
        },
    };
    await self.showProviderTypeSelector();
}
// ---------------------------------------------------------------------------
// Auto-fetch models from /models endpoint
// ---------------------------------------------------------------------------
async function fetchModels(baseUrl, apiKeyCfg) {
    let key = apiKeyCfg;
    if (apiKeyCfg.startsWith("$")) {
        const envName = apiKeyCfg.replace(/^\$\{?/, "").replace(/\}$/, "");
        key = process.env[envName] ?? apiKeyCfg;
    }
    const headers = { "Content-Type": "application/json" };
    if (!key.includes("$") || key !== apiKeyCfg)
        headers["Authorization"] = `Bearer ${key}`;
    const url = baseUrl.replace(/\/+$/, "") + "/models";
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!resp.ok)
        throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json());
    const raw = data.data ?? data.models?.map((m) => ({ id: m.name })) ?? [];
    return raw.map((item) => ({
        id: item.id ?? item.name ?? "unknown",
        name: item.name ?? item.id ?? "Unknown",
        reasoning: item.supports_reasoning ?? false,
        input: item.supports_vision ? ["text", "image"] : ["text"],
        contextWindow: item.context_window ?? 128000,
        maxTokens: item.max_tokens ?? 16384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }));
}
