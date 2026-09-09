"use client";

/**
 * Right-click menu for the editor — Obsidian's formatting menu, plus the
 * table/line operations it exposes on a selection.
 *
 * Every action is an ordinary CodeMirror StateCommand, so the same code powers
 * the hotkeys, and every edit lands as a single undoable transaction.
 */

import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PickerDialog } from "@/components/workspace/picker-dialog";
import { attachmentApi, vaultApi } from "@/lib/api/endpoints";
import type { TreeItem } from "@/lib/api/types";
import { toastError, useToastStore } from "@/lib/stores/toast-store";
import { useTranslation } from "@/lib/i18n";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  activeFormats,
  addFileProperty,
  deleteSelection,
  insertExternalLink,
  insertTextAtSelection,
  insertVaultLink,
  toPlainText,
  CALLOUT_TYPES,
  clearFormatting,
  dedupeLines,
  indentLines,
  insertCalloutOfType,
  insertCodeBlock,
  insertDate,
  insertEmbed,
  insertFootnote,
  insertHorizontalRule,
  insertLink,
  insertMathBlock,
  insertMermaid,
  insertTable,
  insertTag,
  insertTime,
  insertWikilink,
  joinLines,
  outdentLines,
  reverseLines,
  setHeading,
  setHighlightColor,
  setTextColor,
  sortLinesAsc,
  sortLinesDesc,
  TEXT_COLORS,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleCheckbox,
  toggleHighlightCmd,
  toggleInlineCode,
  toggleItalic,
  toggleNumberedList,
  toggleStrikethrough,
  toggleSubscript,
  toggleSuperscript,
  toggleTaskList,
  toggleUnderline,
} from "@/lib/editor/format-commands";
import type { ActiveFormats } from "@/lib/editor/format-commands";
import {
  caretInTable,
  tableAlignColumn,
  tableDeleteColumn,
  tableDeleteRow,
  tableFormat,
  tableInsertColumnLeft,
  tableInsertColumnRight,
  tableInsertRowAbove,
  tableInsertRowBelow,
  tableMoveRowDown,
  tableMoveRowUp,
  tableSortByColumn,
} from "@/lib/editor/table-commands";

type Cmd = (view: EditorView) => boolean;

/** Every note in the vault, with its full path, for the link picker. */
function flattenNotes(items: TreeItem[], trail = ""): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const item of items) {
    const name = item.type === "folder" ? item.name : item.title;
    const label = trail ? `${trail}/${name}` : name;
    if (item.type === "folder") out.push(...flattenNotes(item.children, label));
    else out.push({ id: item.title, label });
  }
  return out;
}

/** A one-field dialog — used for "Add external link". */
function UrlDialog({ onSubmit, onClose }: { onSubmit: (url: string) => void; onClose: () => void }) {
  const [url, setUrl] = useState("https://");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[14px]">{t("editorMenu.addExternalLink")}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = url.trim();
            if (trimmed && trimmed !== "https://") onSubmit(trimmed);
          }}
        >
          <input
            autoFocus
            value={url}
            aria-label={t("editorMenu.linkUrl")}
            onChange={(e) => setUrl(e.target.value)}
            onFocus={(e) => e.currentTarget.setSelectionRange(url.length, url.length)}
            className="h-8 w-full rounded border border-ob-border bg-ob-bg px-2 text-[13px] text-ob-text outline-none placeholder:text-ob-faint focus:border-ob-accent"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

const EMPTY_ACTIVE: ActiveFormats = {
  bold: false,
  italic: false,
  strikethrough: false,
  highlight: false,
  code: false,
  underline: false,
  heading: 0,
  bulletList: false,
  numberedList: false,
  taskList: false,
  quote: false,
};

/** One command row. Declared at module scope: a component created during
 *  render would remount (and lose state) on every parent render. */
function Item({
  label,
  shortcut,
  onSelect,
  disabled,
}: {
  label: string;
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <ContextMenuItem onSelect={onSelect} disabled={disabled}>
      {label}
      {shortcut && <ContextMenuShortcut>{shortcut}</ContextMenuShortcut>}
    </ContextMenuItem>
  );
}

/** A command that reports whether it is currently in effect. Rendered as a
 *  menuitemcheckbox so the state is exposed to assistive tech (and to tests),
 *  not just drawn as a tick. */
function ToggleItem({
  label,
  shortcut,
  checked,
  onSelect,
}: {
  label: string;
  shortcut?: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <ContextMenuCheckboxItem checked={checked} onSelect={onSelect}>
      {label}
      {shortcut && <ContextMenuShortcut>{shortcut}</ContextMenuShortcut>}
    </ContextMenuCheckboxItem>
  );
}

/** A colour row with its swatch, so the palette is readable at a glance. */
function ColorItem({
  name,
  value,
  onSelect,
}: {
  name: string;
  value: string;
  onSelect: () => void;
}) {
  return (
    <ContextMenuItem onSelect={onSelect}>
      <span
        aria-hidden
        className="mr-2 inline-block size-3 rounded-full border border-border/50"
        style={{ background: value }}
      />
      {name}
    </ContextMenuItem>
  );
}

export interface EditorContextMenuActions {
  /** Create a new note (Obsidian's "+ New"). */
  onNewNote?: () => void;
  /** Create a new note whose title is the selected text and link to it. */
  onExtractSelection?: (text: string) => void;
}

export function EditorContextMenu({
  getView,
  vaultId,
  actions,
  children,
}: {
  /** The live editor. A getter, because the view is created after mount. */
  getView: () => EditorView | null;
  vaultId: string;
  actions?: EditorContextMenuActions;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const toast = useToastStore((s) => s.push);
  const setLeftPane = useWorkspaceStore((s) => s.setLeftPane);
  const setSearchSeed = useWorkspaceStore((s) => s.setSearchSeed);
  const leftSidebarOpen = useWorkspaceStore((s) => s.leftSidebarOpen);
  const toggleLeftSidebar = useWorkspaceStore((s) => s.toggleLeftSidebar);

  /** "note" opens the vault picker, "url" the external-link dialog. */
  const [linking, setLinking] = useState<"note" | "url" | null>(null);

  const { data: tree } = useQuery({
    queryKey: ["tree", vaultId],
    queryFn: () => vaultApi.tree(vaultId),
    enabled: linking === "note",
  });
  const { data: attachments } = useQuery({
    queryKey: ["attachments", vaultId],
    queryFn: () => attachmentApi.list(vaultId),
    enabled: linking === "note",
  });
  // Sampled when the menu opens: the editor's selection is what the commands
  // will act on, and reading it during render would be a live-state read.
  const [ctx, setCtx] = useState<{
    inTable: boolean;
    hasSelection: boolean;
    selected: string;
    formats: ActiveFormats | null;
  }>({ inTable: false, hasSelection: false, selected: "", formats: null });

  /** Run a command against the editor and keep focus in the document —
   *  otherwise the caret is left in the (now closed) menu. */
  const run = (cmd: Cmd) => () => {
    const view = getView();
    if (!view) return;
    cmd(view);
    view.focus();
  };

  const onOpenChange = (open: boolean) => {
    if (!open) return;
    const view = getView();
    if (!view) return;
    const { from, to } = view.state.selection.main;
    setCtx({
      inTable: caretInTable(view.state),
      hasSelection: from !== to,
      selected: view.state.sliceDoc(from, to),
      formats: activeFormats(view.state),
    });
  };

  /** Send the selected words to the sidebar search pane. */
  const searchSelection = () => {
    setLeftPane("search");
    if (!leftSidebarOpen) toggleLeftSidebar();
    setSearchSeed(ctx.selected.trim());
  };

  /** Clipboard reads can be refused by the browser — Chrome asks for
   *  permission, Firefox declines outright — so failures are reported rather
   *  than swallowed. ⌘V always works regardless. */
  const paste = (plain: boolean) => async () => {
    const view = getView();
    if (!view) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      insertTextAtSelection(plain ? toPlainText(text) : text)(view);
      view.focus();
    } catch {
      toast(t("editorMenu.clipboardRead"));
    }
  };

  const copy = (cut: boolean) => async () => {
    const view = getView();
    if (!view || !ctx.selected) return;
    try {
      await navigator.clipboard.writeText(ctx.selected);
      if (cut) deleteSelection(view);
      view.focus();
    } catch (e) {
      toastError(e, t("editorMenu.clipboardWrite"));
    }
  };

  const linkTargets = [
    ...flattenNotes(tree?.items ?? []),
    ...(attachments ?? []).map((a) => ({ id: a.filename, label: a.filename })),
  ];

  // Nothing sampled yet (menu never opened): render everything unchecked.
  const f = ctx.formats ?? EMPTY_ACTIVE;
  const word = ctx.selected.trim().replace(/\s+/g, " ");
  const shortWord = word.length > 24 ? `${word.slice(0, 24)}…` : word;

  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        {/* 1 — what you do with the words you just selected. */}
        <Item label={t("editorMenu.addLink")} onSelect={() => setLinking("note")} />
        <Item label={t("editorMenu.addExternalLink")} onSelect={() => setLinking("url")} />
        <Item
          label={word ? t("editorMenu.searchFor", { word: shortWord }) : t("editorMenu.searchForEmpty")}
          disabled={!word}
          onSelect={searchSelection}
        />

        <ContextMenuSeparator />

        {/* 2 — formatting. */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("editorMenu.format") }</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ToggleItem label={t("editorMenu.bold")} checked={f.bold} onSelect={run(toggleBold)} shortcut="⌘B" />
            <ToggleItem label={t("editorMenu.italic")} checked={f.italic} onSelect={run(toggleItalic)} shortcut="⌘I" />
            <ToggleItem
              label={t("editorMenu.underline")}
              checked={f.underline}
              onSelect={run(toggleUnderline)}
              shortcut="⌘U"
            />
            <ToggleItem
              label={t("editorMenu.strikethrough")}
              checked={f.strikethrough}
              onSelect={run(toggleStrikethrough)}
            />
            <ToggleItem
              label={t("editorMenu.highlight")}
              checked={f.highlight}
              onSelect={run(toggleHighlightCmd)}
              shortcut="⌘⇧H"
            />
            <ContextMenuSeparator />
            <Item label={t("editorMenu.superscript")} onSelect={run(toggleSuperscript)} />
            <Item label={t("editorMenu.subscript")} onSelect={run(toggleSubscript)} />
            <ToggleItem label={t("editorMenu.inlineCode")} checked={f.code} onSelect={run(toggleInlineCode)} />
            <Item label={t("editorMenu.codeBlock")} onSelect={run(insertCodeBlock)} />
            <ContextMenuSeparator />
            <Item label={t("editorMenu.clearFormatting")} onSelect={run(clearFormatting)} />
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("editorMenu.textColour") }</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            {TEXT_COLORS.map((c) => (
              <ColorItem key={c.value} name={c.name} value={c.value} onSelect={run(setTextColor(c.value))} />
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("editorMenu.highlightColour") }</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            {TEXT_COLORS.map((c) => (
              <ColorItem
                key={c.value}
                name={c.name}
                value={c.value}
                onSelect={run(setHighlightColor(c.value))}
              />
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("editorMenu.paragraph") }</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-52">
            <ToggleItem label={t("editorMenu.plainText")} checked={f.heading === 0} onSelect={run(setHeading(0))} />
            <ContextMenuSeparator />
            {([1, 2, 3, 4, 5, 6] as const).map((level) => (
              <ToggleItem
                key={level}
                label={t("editorMenu.heading", { level })}
                checked={f.heading === level}
                shortcut={`⌘${String(level)}`}
                onSelect={run(setHeading(level))}
              />
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("editorMenu.lists") }</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-52">
            <ToggleItem label={t("editorMenu.bulletList")} checked={f.bulletList} onSelect={run(toggleBulletList)} />
            <ToggleItem
              label={t("editorMenu.numberedList")}
              checked={f.numberedList}
              onSelect={run(toggleNumberedList)}
            />
            <ToggleItem label={t("editorMenu.taskList")} checked={f.taskList} onSelect={run(toggleTaskList)} />
            <Item label={t("editorMenu.toggleCheckbox")} onSelect={run(toggleCheckbox)} shortcut="⌘⏎" />
            <ContextMenuSeparator />
            <ToggleItem label={t("editorMenu.blockquote")} checked={f.quote} onSelect={run(toggleBlockquote)} />
            <ContextMenuSeparator />
            <Item label={t("editorMenu.indent")} onSelect={run(indentLines)} shortcut="⇥" />
            <Item label={t("editorMenu.outdent")} onSelect={run(outdentLines)} shortcut="⇧⇥" />
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("editorMenu.insert") }</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <Item label={t("editorMenu.link")} onSelect={run(insertLink)} shortcut="⌘K" />
            <Item label={t("editorMenu.wikilink")} onSelect={run(insertWikilink)} shortcut="[[" />
            <Item label={t("editorMenu.embed")} onSelect={run(insertEmbed)} />
            <Item label={t("editorMenu.tag")} onSelect={run(insertTag)} />
            <ContextMenuSeparator />
            <Item label={t("editorMenu.table")} onSelect={run(insertTable())} />
            <Item label={t("editorMenu.horizontalRule")} onSelect={run(insertHorizontalRule)} />
            <Item label={t("editorMenu.footnote")} onSelect={run(insertFootnote)} />
            <Item label={t("editorMenu.mathBlock")} onSelect={run(insertMathBlock)} />
            <Item label={t("editorMenu.mermaid")} onSelect={run(insertMermaid)} />
            <ContextMenuSeparator />
            <Item label={t("editorMenu.todaysDate")} onSelect={run(insertDate)} />
            <Item label={t("editorMenu.currentTime")} onSelect={run(insertTime)} />
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("editorMenu.callout") }</ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-80 w-44 overflow-y-auto">
            {CALLOUT_TYPES.map((type) => (
              <ContextMenuItem key={type} onSelect={run(insertCalloutOfType(type))} className="capitalize">
                {type}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          {/* Never gated: "Table" is where people look to CREATE one. Gating the
              whole group made the obvious entry point dead. Only the operations
              that need an existing table are disabled. */}
          <ContextMenuSubTrigger>{t("editorMenu.table") }</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <Item label={t("editorMenu.insertTable")} onSelect={run(insertTable())} />
            <ContextMenuSeparator />
            <Item label={t("editorMenu.insertRowAbove")} disabled={!ctx.inTable} onSelect={run(tableInsertRowAbove)} />
            <Item label={t("editorMenu.insertRowBelow")} disabled={!ctx.inTable} onSelect={run(tableInsertRowBelow)} />
            <Item label={t("editorMenu.moveRowUp")} disabled={!ctx.inTable} onSelect={run(tableMoveRowUp)} shortcut="⌥↑" />
            <Item label={t("editorMenu.moveRowDown")} disabled={!ctx.inTable} onSelect={run(tableMoveRowDown)} shortcut="⌥↓" />
            <Item label={t("editorMenu.deleteRow")} disabled={!ctx.inTable} onSelect={run(tableDeleteRow)} />
            <ContextMenuSeparator />
            <Item label={t("editorMenu.insertColumnLeft")} disabled={!ctx.inTable} onSelect={run(tableInsertColumnLeft)} />
            <Item label={t("editorMenu.insertColumnRight")} disabled={!ctx.inTable} onSelect={run(tableInsertColumnRight)} />
            <Item label={t("editorMenu.deleteColumn")} disabled={!ctx.inTable} onSelect={run(tableDeleteColumn)} />
            <ContextMenuSeparator />
            <Item label={t("editorMenu.alignLeft")} disabled={!ctx.inTable} onSelect={run(tableAlignColumn("left"))} />
            <Item label={t("editorMenu.alignCentre")} disabled={!ctx.inTable} onSelect={run(tableAlignColumn("center"))} />
            <Item label={t("editorMenu.alignRight")} disabled={!ctx.inTable} onSelect={run(tableAlignColumn("right"))} />
            <ContextMenuSeparator />
            <Item label={t("editorMenu.sortColumnAsc")} disabled={!ctx.inTable} onSelect={run(tableSortByColumn("asc"))} />
            <Item label={t("editorMenu.sortColumnDesc")} disabled={!ctx.inTable} onSelect={run(tableSortByColumn("desc"))} />
            <Item label={t("editorMenu.formatTable")} disabled={!ctx.inTable} onSelect={run(tableFormat)} />
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={!ctx.hasSelection}>{t("editorMenu.sortFilterLines")}</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-52">
            <Item label={t("editorMenu.sortAsc")} onSelect={run(sortLinesAsc)} />
            <Item label={t("editorMenu.sortDesc")} onSelect={run(sortLinesDesc)} />
            <Item label={t("editorMenu.reverse")} onSelect={run(reverseLines)} />
            <ContextMenuSeparator />
            <Item label={t("editorMenu.removeDuplicates")} onSelect={run(dedupeLines)} />
            <Item label={t("editorMenu.joinLine")} onSelect={run(joinLines)} />
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("editorMenu.properties") }</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-52">
            <Item label={t("editorMenu.addFileProperty")} onSelect={run(addFileProperty)} />
          </ContextMenuSubContent>
        </ContextMenuSub>

        {actions?.onNewNote && <Item label={t("editorMenu.newNote")} onSelect={actions.onNewNote} shortcut="⌘N" />}
        {actions?.onExtractSelection && (
          <Item
            label={t("editorMenu.newNoteSelection")}
            disabled={!ctx.hasSelection}
            onSelect={() => actions.onExtractSelection?.(ctx.selected)}
          />
        )}

        <Item
          label={t("editorMenu.find")}
          shortcut="⌘F"
          onSelect={() => {
            const view = getView();
            if (view) openSearchPanel(view);
          }}
        />

        <ContextMenuSeparator />

        {/* 3 — clipboard. */}
        <Item label={t("editorMenu.cut")} shortcut="⌘X" disabled={!ctx.hasSelection} onSelect={() => void copy(true)()} />
        <Item label={t("editorMenu.copy")} shortcut="⌘C" disabled={!ctx.hasSelection} onSelect={() => void copy(false)()} />
        <Item label={t("editorMenu.paste")} shortcut="⌘V" onSelect={() => void paste(false)()} />
        <Item label={t("editorMenu.pastePlain")} shortcut="⌘⇧V" onSelect={() => void paste(true)()} />
        <ContextMenuItem
          onSelect={() => {
            const view = getView();
            if (!view) return;
            view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
            view.focus();
          }}
        >
          {t("editorMenu.selectAll")}
          <ContextMenuShortcut>⌘A</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>

      {linking === "note" && (
        <PickerDialog
          title={t("editorMenu.linkPickerTitle")}
          items={linkTargets}
          emptyLabel={t("editorMenu.nothingToLink")}
          onPick={(id) => {
            setLinking(null);
            const view = getView();
            if (!view || !id) return;
            insertVaultLink(id)(view);
            view.focus();
          }}
          onClose={() => setLinking(null)}
        />
      )}
      {linking === "url" && (
        <UrlDialog
          onSubmit={(url) => {
            setLinking(null);
            const view = getView();
            if (!view) return;
            insertExternalLink(url)(view);
            view.focus();
          }}
          onClose={() => setLinking(null)}
        />
      )}
    </ContextMenu>
  );
}
