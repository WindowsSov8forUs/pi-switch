import { providerId } from "./store.js";
// ---------------------------------------------------------------------------
// Model conversion
// ---------------------------------------------------------------------------
export function modelToDef(m) {
    return {
        id: m.id, name: m.name ?? m.id, reasoning: m.reasoning ?? false,
        input: m.input ?? ["text"],
        contextWindow: m.contextWindow, maxTokens: m.maxTokens,
        cost: m.cost
            ? { input: m.cost.input, output: m.cost.output, cacheRead: m.cost.cacheRead, cacheWrite: m.cost.cacheWrite }
            : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        api: m.api, baseUrl: m.baseUrl, headers: m.headers,
        thinkingLevelMap: m.thinkingLevelMap, compat: m.compat,
    };
}
// ---------------------------------------------------------------------------
// Register provider (does NOT switch model)
// ---------------------------------------------------------------------------
export async function activateAccount(ctx, pi, key, account) {
    const pid = providerId(key, account.id);
    if (key.startsWith("custom:")) {
        const blob = account.data;
        if (!blob.baseUrl || !blob.api) {
            ctx.ui.notify("Custom provider missing baseUrl or api.", "error");
            return;
        }
        pi.registerProvider(pid, {
            name: account.name,
            baseUrl: blob.baseUrl, apiKey: blob.apiKey, api: blob.api,
            headers: blob.headers, authHeader: blob.authHeader ?? true,
            models: (blob.models ?? []).map((m) => ({
                id: m.id, name: m.name, reasoning: m.reasoning, input: m.input,
                contextWindow: m.contextWindow, maxTokens: m.maxTokens, cost: m.cost,
                api: m.api, baseUrl: m.baseUrl ?? blob.baseUrl,
                headers: m.headers, thinkingLevelMap: m.thinkingLevelMap, compat: m.compat,
            })),
        });
    }
    else {
        const baseModels = ctx.modelRegistry.getAll().filter((m) => m.provider === key);
        if (baseModels.length === 0) {
            ctx.ui.notify(`No models found for built-in provider "${key}"`, "error");
            return;
        }
        const defs = baseModels.map(modelToDef);
        const cred = account.data;
        const apiKey = cred.type === "api_key" ? cred.key : cred.access;
        pi.registerProvider(pid, {
            name: account.name,
            baseUrl: defs[0].baseUrl, apiKey, api: defs[0].api, authHeader: true,
            models: defs.map((m) => ({
                id: m.id, name: m.name, reasoning: m.reasoning, input: m.input,
                contextWindow: m.contextWindow, maxTokens: m.maxTokens, cost: m.cost,
                api: m.api, baseUrl: m.baseUrl, headers: m.headers,
                thinkingLevelMap: m.thinkingLevelMap, compat: m.compat,
            })),
        });
    }
    ctx.ui.notify(`Registered "${account.name}" (${pid}). Use /model to select.`, "info");
}
