import { Container, fuzzyFilter, getKeybindings, Input, Spacer, Text, TruncatedText, } from "@earendil-works/pi-tui";
import { DynamicBorder, ExtensionSelectorComponent } from "@earendil-works/pi-coding-agent";
// ---------------------------------------------------------------------------
// Searchable selector (like OAuthSelectorComponent)
// ---------------------------------------------------------------------------
export class SearchSelector extends Container {
    searchInput;
    listContainer;
    allItems;
    filteredItems;
    selectedIndex = 0;
    onSelect;
    onCancel;
    theme;
    _focused = false;
    pinnedItem;
    get focused() { return this._focused; }
    set focused(v) { this._focused = v; this.searchInput.focused = v; }
    constructor(theme, title, items, onSelect, onCancel, opts) {
        super();
        this.theme = theme;
        this.allItems = items;
        this.filteredItems = items;
        this.onSelect = onSelect;
        this.onCancel = onCancel;
        this.pinnedItem = opts?.pinned;
        this.addChild(new DynamicBorder());
        this.addChild(new Spacer(1));
        this.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
        this.addChild(new Spacer(1));
        this.searchInput = new Input();
        this.searchInput.onSubmit = () => {
            const item = this.visibleItemAt(this.selectedIndex);
            if (item)
                this.onSelect(item.value);
        };
        this.addChild(this.searchInput);
        this.addChild(new Spacer(1));
        this.listContainer = new Container();
        this.addChild(this.listContainer);
        this.addChild(new Spacer(1));
        this.addChild(new DynamicBorder());
        this.updateList();
    }
    visibleItems() {
        // pinned item is always at the end, excluded from filtering
        return this.pinnedItem
            ? [...this.filteredItems, this.pinnedItem]
            : this.filteredItems;
    }
    visibleItemAt(index) {
        return this.visibleItems()[index];
    }
    filter(query) {
        this.filteredItems = query
            ? fuzzyFilter(this.allItems, query, (item) => `${item.label} ${item.sublabel ?? ""} ${item.value}`)
            : this.allItems;
        const max = this.visibleItems().length - 1;
        this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, Math.max(0, max)));
        this.updateList();
    }
    updateList() {
        this.listContainer.clear();
        const th = this.theme;
        const items = this.visibleItems();
        const isPinned = (idx) => this.pinnedItem !== undefined && idx === items.length - 1;
        const maxVisible = 8;
        const start = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVisible / 2), items.length - maxVisible));
        const end = Math.min(start + maxVisible, items.length);
        for (let i = start; i < end; i++) {
            const item = items[i];
            if (!item)
                continue;
            const sel = i === this.selectedIndex;
            const pinned = isPinned(i);
            if (sel) {
                const prefix = pinned ? "+ " : "→ ";
                const suffix = item.inlineSuffix
                    ? th.fg(item.inlineSuffixColor ?? "accent", item.inlineSuffix) : "";
                this.listContainer.addChild(new TruncatedText(th.fg("accent", prefix + item.label) + suffix, 1, 0));
            }
            else {
                const prefix = pinned ? "  " : "  ";
                const labelColor = pinned ? "text" : "text";
                const suffix = item.inlineSuffix
                    ? th.fg(item.inlineSuffixColor ?? "muted", item.inlineSuffix) : "";
                this.listContainer.addChild(new TruncatedText(th.fg(labelColor, prefix + item.label) + suffix, 1, 0));
            }
            if (item.sublabel) {
                const color = item.sublabelColor ?? "dim";
                this.listContainer.addChild(new TruncatedText(`   ${th.fg(color, item.sublabel)}`, 1, 0));
            }
        }
        if (items.length === 0) {
            this.listContainer.addChild(new TruncatedText(th.fg("muted", "  No matches"), 1, 0));
        }
    }
    handleInput(keyData) {
        const kb = getKeybindings();
        if (kb.matches(keyData, "tui.select.up")) {
            const max = this.visibleItems().length - 1;
            if (max < 0)
                return;
            this.selectedIndex = Math.max(0, this.selectedIndex - 1);
            this.updateList();
        }
        else if (kb.matches(keyData, "tui.select.down")) {
            const max = this.visibleItems().length - 1;
            if (max < 0)
                return;
            this.selectedIndex = Math.min(max, this.selectedIndex + 1);
            this.updateList();
        }
        else if (kb.matches(keyData, "tui.select.confirm")) {
            const item = this.visibleItemAt(this.selectedIndex);
            if (item)
                this.onSelect(item.value);
        }
        else if (kb.matches(keyData, "tui.select.cancel")) {
            this.onCancel();
        }
        else {
            this.searchInput.handleInput(keyData);
            this.filter(this.searchInput.getValue());
        }
    }
}
// ---------------------------------------------------------------------------
// Wrappers
// ---------------------------------------------------------------------------
export function simpleSelect(ctx, title, options) {
    return new Promise((resolve) => {
        ctx.ui.custom((_tui, _theme, _kb, done) => {
            return new ExtensionSelectorComponent(title, options, (value) => {
                done();
                resolve(value);
            }, () => {
                done();
                resolve(null);
            });
        });
    });
}
export function searchSelect(ctx, title, items, opts) {
    return new Promise((resolve) => {
        ctx.ui.custom((_tui, theme, _kb, done) => {
            return new SearchSelector(theme, title, items, (value) => {
                done();
                resolve(value);
            }, () => {
                done();
                resolve(null);
            }, opts);
        });
    });
}
export async function promptAccount(ctx, key, accounts, opts) {
    const providerName = key.startsWith("custom:") ? key.slice(7) : key;
    const items = accounts.map((a) => ({
        label: a.name,
        sublabel: a.notes || undefined,
        value: a.id,
    }));
    return searchSelect(ctx, `Select account for ${providerName}`, items, opts);
}
