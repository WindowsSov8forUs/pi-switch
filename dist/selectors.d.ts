import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import type { Account, SelectorItem } from "./types.js";
export declare class SearchSelector extends Container {
    private searchInput;
    private listContainer;
    private allItems;
    private filteredItems;
    private selectedIndex;
    private onSelect;
    private onCancel;
    private theme;
    private _focused;
    private pinnedItem?;
    get focused(): boolean;
    set focused(v: boolean);
    constructor(theme: any, title: string, items: SelectorItem[], onSelect: (value: string) => void, onCancel: () => void, opts?: {
        pinned?: SelectorItem;
    });
    private visibleItems;
    private visibleItemAt;
    private filter;
    private updateList;
    handleInput(keyData: string): void;
}
export declare function simpleSelect(ctx: ExtensionContext, title: string, options: string[]): Promise<string | null>;
export declare function searchSelect(ctx: ExtensionContext, title: string, items: SelectorItem[], opts?: {
    pinned?: SelectorItem;
}): Promise<string | null>;
export declare function promptAccount(ctx: ExtensionContext, key: string, accounts: Account[], opts?: {
    pinned?: SelectorItem;
}): Promise<string | null>;
