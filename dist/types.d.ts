import type { Api, Model } from "@earendil-works/pi-ai";
export interface ApiKeyCred {
    type: "api_key";
    key: string;
    env?: Record<string, string>;
}
export interface OAuthCred {
    type: "oauth";
    access: string;
    refresh: string;
    expires: number;
    accountId?: string;
}
export type Credential = ApiKeyCred | OAuthCred;
export interface ProviderModelDef {
    id: string;
    name: string;
    reasoning: boolean;
    input: ("text" | "image")[];
    contextWindow: number;
    maxTokens: number;
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    };
    api?: Api;
    baseUrl?: string;
    headers?: Record<string, string>;
    thinkingLevelMap?: Model<Api>["thinkingLevelMap"];
    compat?: Model<Api>["compat"];
}
export interface ProviderConfig {
    name?: string;
    baseUrl: string;
    api: string;
    apiKey?: string;
    headers?: Record<string, string>;
    authHeader?: boolean;
    models?: ProviderModelDef[];
}
export interface Account {
    id: string;
    name: string;
    notes: string;
    data: Credential | ProviderConfig;
}
export interface SwitchConfig {
    version: 1;
    providers: Record<string, Account[]>;
}
export interface SelectorItem {
    label: string;
    sublabel?: string;
    sublabelColor?: string;
    inlineSuffix?: string;
    inlineSuffixColor?: string;
    value: string;
}
