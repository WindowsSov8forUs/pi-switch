import type { Account, Credential, ProviderConfig, SwitchConfig } from "./types.js";
export declare const CONFIG_PATH: string;
export declare const PROVIDER_PREFIX = "pi-switch";
export declare function ensureConfig(): Promise<SwitchConfig>;
export declare function saveConfig(): Promise<void>;
export declare function slugify(text: string): string;
export declare function providerId(key: string, accountId: string): string;
export declare function isCredential(d: Credential | ProviderConfig): d is Credential;
export declare function saveAccount(key: string, name: string, notes: string, data: Credential | ProviderConfig): Account;
export declare function removeAccount(key: string, accountId: string): void;
export type FlatEntry = {
    key: string;
    account: Account;
};
export declare function flatList(): FlatEntry[];
export declare function displayLine(key: string, a: Account): string;
export declare function deepEqual(a: unknown, b: unknown): boolean;
