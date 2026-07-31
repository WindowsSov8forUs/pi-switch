import type { ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { Account, ProviderModelDef } from "./types.js";
export declare function modelToDef(m: Model<Api>): ProviderModelDef;
export declare function activateAccount(ctx: ExtensionContext, pi: ExtensionAPI, key: string, account: Account): Promise<void>;
