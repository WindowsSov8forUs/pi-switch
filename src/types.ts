import type { Api, Model } from "@earendil-works/pi-ai";

// -- Credentials (auth.json shape) --

export interface ApiKeyCred { type: "api_key"; key: string; env?: Record<string, string> }
export interface OAuthCred { type: "oauth"; access: string; refresh: string; expires: number; accountId?: string }
export type Credential = ApiKeyCred | OAuthCred;

// -- Provider config (models.json shape) --

export interface ProviderModelDef {
  id: string; name: string; reasoning: boolean; input: ("text" | "image")[];
  contextWindow: number; maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  api?: Api; baseUrl?: string; headers?: Record<string, string>;
  thinkingLevelMap?: Model<Api>["thinkingLevelMap"]; compat?: Model<Api>["compat"];
}

export interface ProviderConfig {
  name?: string; baseUrl: string; api: string; apiKey?: string;
  headers?: Record<string, string>; authHeader?: boolean; models?: ProviderModelDef[];
}

// -- Account --

export interface Account {
  id: string; name: string; notes: string;
  data: Credential | ProviderConfig;
}

// -- pi-switch.json --

export interface SwitchConfig {
  version: 1;
  providers: Record<string, Account[]>;
}

// -- Selector item --

export interface SelectorItem {
  label: string;
  sublabel?: string;       // second line
  sublabelColor?: string;  // theme fg for sublabel. default: "dim"
  inlineSuffix?: string;   // appended to label on same line, e.g. "  (3)"
  inlineSuffixColor?: string;  // theme fg for inlineSuffix. default: same as label
  value: string;
}
