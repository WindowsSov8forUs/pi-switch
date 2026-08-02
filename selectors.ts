import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Container, fuzzyFilter, getKeybindings, Input, Spacer, Text, TruncatedText,
} from "@earendil-works/pi-tui";
import { DynamicBorder, ExtensionSelectorComponent, keyHint } from "@earendil-works/pi-coding-agent";
import type { Account, SelectorItem } from "./types.ts";

// ---------------------------------------------------------------------------
// Searchable selector (like OAuthSelectorComponent)
// ---------------------------------------------------------------------------

export class SearchSelector extends Container {
  private searchInput: Input;
  private listContainer: Container;
  private allItems: SelectorItem[];
  private filteredItems: SelectorItem[];
  private selectedIndex = 0;
  private onSelect: (value: string) => void;
  private onCancel: () => void;
  private theme: any;
  private _focused = false;
  private pinnedItem?: SelectorItem;

  get focused() { return this._focused; }
  set focused(v: boolean) { this._focused = v; this.searchInput.focused = v; }

  constructor(
    theme: any,
    title: string,
    items: SelectorItem[],
    onSelect: (value: string) => void,
    onCancel: () => void,
    opts?: { pinned?: SelectorItem },
  ) {
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
      if (item) this.onSelect(item.value);
    };
    this.addChild(this.searchInput);
    this.addChild(new Spacer(1));
    this.listContainer = new Container();
    this.addChild(this.listContainer);
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());

    this.updateList();
  }

  private visibleItems(): SelectorItem[] {
    // pinned item is always at the end, excluded from filtering
    return this.pinnedItem
      ? [...this.filteredItems, this.pinnedItem]
      : this.filteredItems;
  }

  private visibleItemAt(index: number): SelectorItem | undefined {
    return this.visibleItems()[index];
  }

  private filter(query: string) {
    this.filteredItems = query
      ? fuzzyFilter(this.allItems, query,
          (item) => `${item.label} ${item.sublabel ?? ""} ${item.value}`)
      : this.allItems;
    const max = this.visibleItems().length - 1;
    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, Math.max(0, max)));
    this.updateList();
  }

  private updateList() {
    this.listContainer.clear();
    const th = this.theme;
    const items = this.visibleItems();
    const isPinned = (idx: number) => this.pinnedItem !== undefined && idx === items.length - 1;
    const maxVisible = 8;
    const start = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVisible / 2),
      items.length - maxVisible));
    const end = Math.min(start + maxVisible, items.length);

    for (let i = start; i < end; i++) {
      const item = items[i];
      if (!item) continue;
      const sel = i === this.selectedIndex;
      const pinned = isPinned(i);

      if (sel) {
        const prefix = pinned ? "+ " : "→ ";
        const suffix = item.inlineSuffix
          ? th.fg(item.inlineSuffixColor ?? "accent", item.inlineSuffix) : "";
        this.listContainer.addChild(new TruncatedText(
          th.fg("accent", prefix + item.label) + suffix, 1, 0));
      } else {
        const prefix = pinned ? "  " : "  ";
        const labelColor = pinned ? "text" : "text";
        const suffix = item.inlineSuffix
          ? th.fg(item.inlineSuffixColor ?? "muted", item.inlineSuffix) : "";
        this.listContainer.addChild(new TruncatedText(
          th.fg(labelColor, prefix + item.label) + suffix, 1, 0));
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

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.up")) {
      const max = this.visibleItems().length - 1;
      if (max < 0) return;
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.updateList();
    } else if (kb.matches(keyData, "tui.select.down")) {
      const max = this.visibleItems().length - 1;
      if (max < 0) return;
      this.selectedIndex = Math.min(max, this.selectedIndex + 1);
      this.updateList();
    } else if (kb.matches(keyData, "tui.select.confirm")) {
      const item = this.visibleItemAt(this.selectedIndex);
      if (item) this.onSelect(item.value);
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      this.onCancel();
    } else {
      this.searchInput.handleInput(keyData);
      this.filter(this.searchInput.getValue());
    }
  }
}

// ---------------------------------------------------------------------------
// Prefilled text input (pi's ExtensionInputComponent drops the placeholder and
// has no initial-value support, so build a small dialog with Input.setValue)
// ---------------------------------------------------------------------------

class PromptInputDialog extends Container {
  private input: Input;
  private onConfirm: (value: string) => void;
  private onCancel: () => void;
  private _focused = false;

  get focused() { return this._focused; }
  set focused(v: boolean) { this._focused = v; this.input.focused = v; }

  constructor(
    theme: any,
    title: string,
    initialValue: string,
    onConfirm: (value: string) => void,
    onCancel: () => void,
  ) {
    super();
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
    this.addChild(new Spacer(1));
    this.input = new Input();
    this.input.setValue(initialValue);
    this.addChild(this.input);
    this.addChild(new Spacer(1));
    this.addChild(new Text(`${keyHint("tui.select.confirm", "submit")}  ${keyHint("tui.select.cancel", "cancel")}`, 1, 0));
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
      this.onConfirm(this.input.getValue());
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      this.onCancel();
    } else {
      this.input.handleInput(keyData);
    }
  }
}

/** Text input with an initial value; resolves null on cancel. */
export function promptInput(
  ctx: ExtensionContext,
  title: string,
  initialValue = "",
): Promise<string | null> {
  return new Promise((resolve) => {
    ctx.ui.custom<void>((_tui, theme, _kb, done) => {
      return new PromptInputDialog(theme, title, initialValue, (value) => {
        done();
        resolve(value);
      }, () => {
        done();
        resolve(null);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Wrappers
// ---------------------------------------------------------------------------

export function simpleSelect(
  ctx: ExtensionContext,
  title: string,
  options: string[],
): Promise<string | null> {
  return new Promise((resolve) => {
    ctx.ui.custom<void>((_tui, _theme, _kb, done) => {
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

export function searchSelect(
  ctx: ExtensionContext,
  title: string,
  items: SelectorItem[],
  opts?: { pinned?: SelectorItem },
): Promise<string | null> {
  return new Promise((resolve) => {
    ctx.ui.custom<void>((_tui, theme, _kb, done) => {
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

export async function promptAccount(
  ctx: ExtensionContext,
  key: string,
  accounts: Account[],
  opts?: { pinned?: SelectorItem },
): Promise<string | null> {
  const providerName = key.startsWith("custom:") ? key.slice(7) : key;
  const items: SelectorItem[] = accounts.map((a) => ({
    label: a.name,
    sublabel: a.notes || undefined,
    value: a.id,
  }));
  return searchSelect(ctx, `Select account for ${providerName}`, items, opts);
}
