"use client";

/**
 * Settings window (⌘,) — Obsidian-style vertical-tab layout.
 * Account prefs live on the user, locations/formats on the vault.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { AiSettingsTab } from "./ai-settings-tab";
import { ClipperTab } from "./clipper-tab";
import { DeleteAccountSection } from "./delete-account";
import { ApiKeysTab } from "./api-keys-tab";
import { McpSettingsTab } from "./mcp-settings-tab";
import { PluginsTab } from "./plugins-tab";
import { VaultsSection } from "./vaults-section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi, siteApi, vaultApi } from "@/lib/api/endpoints";
import { APP_VERSION, DOCS_URL, HELP_URL } from "@/lib/app-meta";
import { filterHotkeys, HOTKEY_SECTIONS } from "@/lib/hotkeys";
import { useTranslation } from "@/lib/i18n";
import { LanguageSelector } from "./language-selector";
import {
  FONT_CHOICES,
  useEditorSettings,
  useUserPrefs,
  type EditorViewMode,
  type FontChoice,
} from "@/lib/hooks/use-editor-settings";
import { useVaultSettings } from "@/lib/hooks/use-vault-settings";
import { useAuthStore } from "@/lib/stores/auth-store";
import { toastError, useToastStore } from "@/lib/stores/toast-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

const TABS = [
  "General",
  "Editor",
  "Appearance",
  "Interface",
  "Files & links",
  "Hotkeys",
  "Vault",
  "Canvas",
  "Plugins",
  "AI",
  "MCP",
  "API keys",
  "Web Clipper",
  "Publish",
  "Collab",
] as const;
type SettingsTab = (typeof TABS)[number];

const TAB_LABELS: Record<SettingsTab, string> = {
  General: "settings.tabs.general",
  Editor: "settings.tabs.editor",
  Appearance: "settings.tabs.appearance",
  Interface: "settings.tabs.interface",
  "Files & links": "settings.tabs.filesAndLinks",
  Hotkeys: "settings.tabs.hotkeys",
  Vault: "settings.tabs.vault",
  Canvas: "settings.tabs.canvas",
  Plugins: "settings.tabs.plugins",
  AI: "settings.tabs.ai",
  MCP: "settings.tabs.mcp",
  "API keys": "settings.tabs.apiKeys",
  "Web Clipper": "settings.tabs.webClipper",
  Publish: "settings.tabs.publish",
  Collab: "settings.tabs.collab",
};

interface SettingsModalProps {
  vaultId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsModal({ vaultId, open, onOpenChange }: SettingsModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const toast = useToastStore((s) => s.push);
  // Deep link: openSettings("Vault") from anywhere lands on that tab. Derived
  // rather than synced by an effect — a click on any tab takes over from then
  // on, and closing the dialog forgets the choice.
  const requestedTab = useWorkspaceStore((s) => s.settingsTab);
  const [pickedTab, setPickedTab] = useState<SettingsTab | null>(null);
  const tab: SettingsTab =
    pickedTab ??
    ((TABS as readonly string[]).includes(requestedTab ?? "")
      ? (requestedTab as SettingsTab)
      : "General");
  const setTab = setPickedTab;
  const [hotkeyQuery, setHotkeyQuery] = useState("");
  const editorSettings = useEditorSettings();
  const userPrefs = useUserPrefs();
  const vaultSettings = useVaultSettings(vaultId);

  const { data: vaults } = useQuery({ queryKey: ["vaults"], queryFn: vaultApi.list, enabled: open });
  const vault = vaults?.find((v) => v.id === vaultId);
  const settings = (vault?.settings ?? {}) as Record<string, string>;

  const [name, setName] = useState<string | null>(null);
  const [dailyFormat, setDailyFormat] = useState<string | null>(null);
  const [dailyFolder, setDailyFolder] = useState<string | null>(null);
  const [dailyTemplate, setDailyTemplate] = useState<string | null>(null);
  const [templatesFolder, setTemplatesFolder] = useState<string | null>(null);
  const [collabDraft, setCollabDraft] = useState<boolean | null>(null);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");

  const saveProfile = useMutation({
    mutationFn: () => authApi.updateMe({ name: name ?? undefined }),
    onSuccess: () => {
      toast(t("settings.toast.profileSaved"), "info");
    },
    onError: (e) => toastError(e, t("settings.toast.saveProfileFailed")),
  });

  const { data: siteStatus } = useQuery({
    queryKey: ["site-status", vaultId],
    queryFn: () => siteApi.status(vaultId),
    enabled: open,
  });
  const siteToggle = useMutation({
    mutationFn: async (enable: boolean): Promise<void> => {
      if (enable) await siteApi.publish(vaultId);
      else await siteApi.unpublish(vaultId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["site-status", vaultId] });
      toast(t("settings.toast.siteUpdated"), "info");
    },
    onError: (e) => toastError(e, t("settings.toast.siteUpdateFailed")),
  });

  const saveVault = useMutation({
    mutationFn: () =>
      vaultApi.update(vaultId, {
        settings: {
          dailyNoteFormat: dailyFormat ?? settings.dailyNoteFormat ?? "YYYY-MM-DD",
          dailyNoteFolder: dailyFolder ?? settings.dailyNoteFolder ?? "",
          dailyNoteTemplate: dailyTemplate ?? settings.dailyNoteTemplate ?? "",
          templatesFolder: templatesFolder ?? settings.templatesFolder ?? "Templates",
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vaults"] });
      void queryClient.invalidateQueries({ queryKey: ["templates", vaultId] });
      toast(t("settings.toast.vaultSaved"), "info");
    },
    onError: (e) => toastError(e, t("settings.toast.vaultSaveFailed")),
  });

  // Editor prefs save themselves on change (users.settings is shallow-merged).
  // Applied optimistically so the editor updates the instant a toggle flips;
  // the server response (or an error rollback) reconciles afterwards.
  const saveEditorSettings = useMutation({
    mutationFn: (patch: Record<string, unknown>) => authApi.updateMe({ settings: patch }),
    onMutate: (patch) => {
      const current = useAuthStore.getState().user;
      if (current) setUser({ ...current, settings: { ...current.settings, ...patch } });
      return { previous: current };
    },
    onSuccess: (updated) => {
      setUser(updated);
      toast(t("settings.toast.editorSaved"), "info");
    },
    onError: (e, _patch, ctx) => {
      if (ctx?.previous) setUser(ctx.previous);
      toastError(e, t("settings.toast.editorSaveFailed"));
    },
  });
  // Slider drags fire per-step — debounce so one release = one PATCH
  const [fontSizeDraft, setFontSizeDraft] = useState<number | null>(null);
  const fontSizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFontSizeChange = (value: number) => {
    setFontSizeDraft(value);
    if (fontSizeTimer.current) clearTimeout(fontSizeTimer.current);
    fontSizeTimer.current = setTimeout(
      () => saveEditorSettings.mutate({ editorFontSize: value }),
      400,
    );
  };

  // Collab lives on its own tab, so the toggle saves itself (backend merges patches)
  const saveCollab = useMutation({
    mutationFn: (enabled: boolean) =>
      vaultApi.update(vaultId, { settings: { collabEnabled: enabled } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vaults"] });
      toast(t("settings.toast.collabSaved"), "info");
    },
    onError: (e) => toastError(e, t("settings.toast.collabSaveFailed")),
  });

  // Files & links vault-level prefs — immediate patch saves
  const saveVaultPatch = useMutation({
    mutationFn: (patch: Record<string, unknown>) => vaultApi.update(vaultId, { settings: patch }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vaults"] });
      toast(t("settings.toast.vaultSaved"), "info");
    },
    onError: (e) => toastError(e, t("settings.toast.vaultSaveFailed")),
  });
  const [newNoteFolderDraft, setNewNoteFolderDraft] = useState<string | null>(null);
  const newNoteFolderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onNewNoteFolderChange = (value: string) => {
    setNewNoteFolderDraft(value);
    if (newNoteFolderTimer.current) clearTimeout(newNoteFolderTimer.current);
    newNoteFolderTimer.current = setTimeout(
      () => saveVaultPatch.mutate({ newNoteFolder: value.trim() }),
      500,
    );
  };
  // Text inputs on the Files & links tab debounce their PATCH like above.
  const [attachmentDraft, setAttachmentDraft] = useState<string | null>(null);
  const attachmentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAttachmentFolderChange = (value: string) => {
    setAttachmentDraft(value);
    if (attachmentTimer.current) clearTimeout(attachmentTimer.current);
    attachmentTimer.current = setTimeout(
      () => saveVaultPatch.mutate({ attachmentFolder: value.trim() }),
      500,
    );
  };
  const [excludedDraft, setExcludedDraft] = useState<string | null>(null);
  const excludedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onExcludedChange = (value: string) => {
    setExcludedDraft(value);
    if (excludedTimer.current) clearTimeout(excludedTimer.current);
    excludedTimer.current = setTimeout(
      () =>
        saveVaultPatch.mutate({
          excludedPaths: value
            .split("\n")
            .map((p) => p.trim())
            .filter(Boolean),
        }),
      500,
    );
  };
  // Accent colour drags fire per-frame — debounce like the font slider
  const [accentDraft, setAccentDraft] = useState<string | null>(null);
  const accentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAccentChange = (value: string) => {
    setAccentDraft(value);
    if (accentTimer.current) clearTimeout(accentTimer.current);
    accentTimer.current = setTimeout(() => saveEditorSettings.mutate({ accentColor: value }), 400);
  };

  const changePassword = useMutation({
    mutationFn: () => authApi.changePassword({ current_password: currentPw, new_password: newPw }),
    onSuccess: () => {
      setCurrentPw("");
      setNewPw("");
      toast(t("settings.password.changedLogout"), "info");
    },
    onError: (e) => toastError(e, t("settings.toast.vaultSaveFailed")),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setPickedTab(null); // reopening honours the next deep link
        onOpenChange(next);
      }}
    >
      <DialogContent className="gap-0 overflow-clip border-ob-border bg-ob-sidebar p-0 sm:max-w-[1040px]">
        <DialogHeader className="border-b border-ob-border px-5 pt-4 pb-3">
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("settings.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-[min(660px,82vh)] min-h-0 flex-col sm:flex-row">
          <nav
            aria-label="Settings sections"
            className="flex shrink-0 flex-row gap-0.5 overflow-x-auto border-b border-ob-border p-2 sm:w-44 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:border-r sm:border-b-0"
          >
            {TABS.map((tabValue) => (
              <button
                key={tabValue}
                type="button"
                aria-pressed={tab === tabValue}
                onClick={() => setTab(tabValue)}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors duration-100",
                  tab === tabValue
                    ? "bg-ob-active text-ob-text"
                    : "text-ob-muted hover:bg-ob-hover hover:text-ob-text",
                )}
              >
                {t(TAB_LABELS[tabValue])}
              </button>
            ))}
          </nav>

          <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {tab === "Plugins" && <PluginsTab vaultId={vaultId} />}
            {tab === "AI" && <AiSettingsTab vaultId={vaultId} vaultName={vault?.name} />}
            {tab === "MCP" && <McpSettingsTab />}
            {tab === "API keys" && <ApiKeysTab />}

            {tab === "Web Clipper" && <ClipperTab />}

            {tab === "General" && (
              <>
                <section className="space-y-2">
                  <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                    {t("settings.sections.about")}
                  </h3>
                  <div className="flex items-center justify-between gap-4 text-[13px] text-ob-muted">
                    <span>
                      {t("settings.about.version", { version: APP_VERSION })}
                      <span className="block text-[11px] text-ob-faint">
                        {t("settings.about.tagline")}
                      </span>
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          onOpenChange(false);
                          useWorkspaceStore.getState().setTourOpen(true);
                        }}
                        className="rounded-md border border-ob-border px-2.5 py-1 text-[12px] text-ob-muted hover:text-ob-text"
                      >
                        {t("settings.about.showTour")}
                      </button>
                      <a
                        href={DOCS_URL}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="rounded-md border border-ob-border px-2.5 py-1 text-[12px] text-ob-muted hover:text-ob-text"
                      >
                        {t("settings.about.documentation")}
                      </a>
                      <a
                        href={HELP_URL}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="rounded-md border border-ob-border px-2.5 py-1 text-[12px] text-ob-muted hover:text-ob-text"
                      >
                        {t("settings.about.github")}
                      </a>
                    </div>
                  </div>
                </section>

                <section className="space-y-3 border-t border-ob-border pt-4">
                  <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                    {t("language.label")}
                  </h3>
                  <LanguageSelector />
                </section>

                <section className="space-y-3 border-t border-ob-border pt-4">
                  <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                    {t("settings.sections.account")}
                  </h3>
                  <div className="space-y-2">
                    <Label htmlFor="settings-name">{t("settings.account.displayName")}</Label>
                    <Input
                      id="settings-name"
                      value={name ?? user?.name ?? ""}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <p className="text-[12px] text-ob-faint">
                    {t("settings.account.signedInAs", { email: user?.email ?? "" })}
                  </p>
                  <Button
                    size="sm"
                    onClick={() => saveProfile.mutate()}
                    disabled={saveProfile.isPending}
                  >
                    {t("settings.account.saveProfile")}
                  </Button>
                </section>

                <section className="space-y-3 border-t border-ob-border pt-4">
                  <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                    {t("settings.sections.password")}
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="pw-current">{t("settings.password.current")}</Label>
                      <Input
                        id="pw-current"
                        type="password"
                        value={currentPw}
                        onChange={(e) => setCurrentPw(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pw-new">{t("settings.password.new")}</Label>
                      <Input
                        id="pw-new"
                        type="password"
                        value={newPw}
                        onChange={(e) => setNewPw(e.target.value)}
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => changePassword.mutate()}
                    disabled={changePassword.isPending || !currentPw || newPw.length < 8}
                  >
                    {t("settings.password.changePassword")}
                  </Button>
                </section>

                <DeleteAccountSection email={user?.email} />
              </>
            )}

            {tab === "Editor" && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                  {t("settings.sections.editor")}
                </h3>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="default-view-mode" className="font-normal text-ob-muted">
                    {t("settings.editor.defaultViewMode")}
                  </Label>
                  <select
                    id="default-view-mode"
                    value={editorSettings.defaultViewMode}
                    onChange={(e) =>
                      saveEditorSettings.mutate({
                        defaultViewMode: e.target.value as EditorViewMode,
                      })
                    }
                    className="rounded-md border border-ob-border bg-ob-primary px-2 py-1 text-[13px] text-ob-text"
                  >
                    <option value="live">{t("settings.editor.viewModeLive")}</option>
                    <option value="source">{t("settings.editor.viewModeSource")}</option>
                    <option value="reading">{t("settings.editor.viewModeReading")}</option>
                  </select>
                </div>

                <SettingToggle
                  label={t("settings.editor.readableLineLength")}
                  hint={t("settings.editor.readableLineLengthHint")}
                  checked={editorSettings.readableLineLength}
                  onChange={(v) => saveEditorSettings.mutate({ readableLineLength: v })}
                />
                <SettingToggle
                  label={t("settings.editor.showLineNumbers")}
                  hint={t("settings.editor.showLineNumbersHint")}
                  checked={editorSettings.showLineNumbers}
                  onChange={(v) => saveEditorSettings.mutate({ showLineNumbers: v })}
                />
                <SettingToggle
                  label={t("settings.editor.spellcheck")}
                  hint={t("settings.editor.spellcheckHint")}
                  checked={editorSettings.spellcheck}
                  onChange={(v) => saveEditorSettings.mutate({ spellcheck: v })}
                />

                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="editor-font-size" className="font-normal text-ob-muted">
                      {t("settings.editor.fontSize")}
                    </Label>
                    <span className="text-[12px] text-ob-faint">
                      {t("settings.editor.fontSizeUnit", { size: fontSizeDraft ?? editorSettings.editorFontSize })}
                    </span>
                  </div>
                  <input
                    id="editor-font-size"
                    type="range"
                    min={14}
                    max={24}
                    step={1}
                    value={fontSizeDraft ?? editorSettings.editorFontSize}
                    onChange={(e) => onFontSizeChange(Number(e.target.value))}
                    className="w-full accent-[var(--ob-interactive-accent)]"
                  />
                </div>
              </section>
            )}

            {tab === "Appearance" && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                  {t("settings.sections.appearance")}
                </h3>
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="accent-color" className="font-normal text-ob-muted">
                    {t("settings.appearance.accentColor")}
                    <span className="block text-[11px] font-normal text-ob-faint">
                      {t("settings.appearance.accentColorHint")}
                    </span>
                  </Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="accent-color"
                      type="color"
                      aria-label={t("settings.appearance.accentColor")}
                      value={accentDraft ?? userPrefs.accentColor ?? "#8b78e6"}
                      onChange={(e) => onAccentChange(e.target.value)}
                      className="h-7 w-10 cursor-pointer rounded border border-ob-border bg-transparent"
                    />
                    {(accentDraft ?? userPrefs.accentColor) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAccentDraft(null);
                          saveEditorSettings.mutate({ accentColor: null });
                        }}
                      >
                        {t("common.reset")}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="scheme" className="font-normal text-ob-muted">
                    {t("settings.appearance.colorScheme")}
                    <span className="block text-[11px] font-normal text-ob-faint">
                      {t("settings.appearance.colorSchemeHint")}
                    </span>
                  </Label>
                  <select
                    id="scheme"
                    disabled
                    value="dark"
                    className="rounded-md border border-ob-border bg-ob-primary px-2 py-1 text-[13px] text-ob-faint"
                  >
                    <option value="dark">{t("settings.appearance.dark")}</option>
                  </select>
                </div>

                <FontSelect
                  id="font-interface"
                  label={t("settings.appearance.interfaceFont")}
                  value={userPrefs.fontInterface}
                  onChange={(v) => saveEditorSettings.mutate({ fontInterface: v })}
                />
                <FontSelect
                  id="font-text"
                  label={t("settings.appearance.textFont")}
                  value={userPrefs.fontText}
                  onChange={(v) => saveEditorSettings.mutate({ fontText: v })}
                />
                <FontSelect
                  id="font-monospace"
                  label={t("settings.appearance.monospaceFont")}
                  value={userPrefs.fontMonospace}
                  onChange={(v) => saveEditorSettings.mutate({ fontMonospace: v })}
                />
              </section>
            )}

            {tab === "Interface" && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                  {t("settings.sections.interface")}
                </h3>
                <SettingToggle
                  label={t("settings.interface.showRibbon")}
                  hint={t("settings.interface.showRibbonHint")}
                  checked={userPrefs.showRibbon}
                  onChange={(v) => saveEditorSettings.mutate({ showRibbon: v })}
                />
                <SettingToggle
                  label={t("settings.interface.showTabTitleBar")}
                  hint={t("settings.interface.showTabTitleBarHint")}
                  checked={userPrefs.showTabTitleBar}
                  onChange={(v) => saveEditorSettings.mutate({ showTabTitleBar: v })}
                />
              </section>
            )}

            {tab === "Files & links" && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                  {t("settings.sections.filesAndLinks")}
                </h3>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="new-note-location" className="font-normal text-ob-muted">
                    {t("settings.filesAndLinks.newNoteLocation")}
                  </Label>
                  <select
                    id="new-note-location"
                    value={(settings.newNoteLocation as string) ?? "root"}
                    onChange={(e) => saveVaultPatch.mutate({ newNoteLocation: e.target.value })}
                    className="rounded-md border border-ob-border bg-ob-primary px-2 py-1 text-[13px] text-ob-text"
                  >
                    <option value="root">{t("settings.filesAndLinks.locationRoot")}</option>
                    <option value="current">{t("settings.filesAndLinks.locationCurrent")}</option>
                    <option value="folder">{t("settings.filesAndLinks.locationFolder")}</option>
                  </select>
                </div>
                {((settings.newNoteLocation as string) ?? "root") === "folder" && (
                  <div className="space-y-2">
                    <Label htmlFor="new-note-folder">{t("settings.filesAndLinks.newNoteFolder")}</Label>
                    <Input
                      id="new-note-folder"
                      placeholder={t("settings.filesAndLinks.newNoteFolder")}
                      value={newNoteFolderDraft ?? (settings.newNoteFolder as string) ?? ""}
                      onChange={(e) => onNewNoteFolderChange(e.target.value)}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="attachment-folder">{t("settings.filesAndLinks.attachmentFolder")}</Label>
                  <Input
                    id="attachment-folder"
                    placeholder={t("settings.filesAndLinks.attachmentFolder")}
                    value={attachmentDraft ?? vaultSettings.attachmentFolder}
                    onChange={(e) => onAttachmentFolderChange(e.target.value)}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="link-format" className="font-normal text-ob-muted">
                    {t("settings.filesAndLinks.linkFormat")}
                  </Label>
                  <select
                    id="link-format"
                    value={vaultSettings.linkFormat}
                    onChange={(e) => saveVaultPatch.mutate({ linkFormat: e.target.value })}
                    className="rounded-md border border-ob-border bg-ob-primary px-2 py-1 text-[13px] text-ob-text"
                  >
                    <option value="shortest">{t("settings.filesAndLinks.linkFormatShortest")}</option>
                    <option value="relative">{t("settings.filesAndLinks.linkFormatRelative")}</option>
                    <option value="absolute">{t("settings.filesAndLinks.linkFormatAbsolute")}</option>
                  </select>
                </div>

                <SettingToggle
                  label={t("settings.filesAndLinks.useWikilinks")}
                  hint={t("settings.filesAndLinks.useWikilinksHint")}
                  checked={vaultSettings.useWikilinks}
                  onChange={(v) => saveVaultPatch.mutate({ useWikilinks: v })}
                />
                <SettingToggle
                  label={t("settings.filesAndLinks.confirmDelete")}
                  hint={t("settings.filesAndLinks.confirmDeleteHint")}
                  checked={userPrefs.confirmDelete}
                  onChange={(v) => saveEditorSettings.mutate({ confirmDelete: v })}
                />
                <SettingToggle
                  label={t("settings.filesAndLinks.previewRequiresCmd")}
                  hint={t("settings.filesAndLinks.previewRequiresCmdHint")}
                  checked={userPrefs.previewRequireCmd}
                  onChange={(v) => saveEditorSettings.mutate({ previewRequireCmd: v })}
                />

                <div className="space-y-2">
                  <Label htmlFor="excluded-paths">{t("settings.filesAndLinks.excludedFiles")}</Label>
                  <textarea
                    id="excluded-paths"
                    rows={3}
                    placeholder={t("settings.filesAndLinks.excludedFilesPlaceholder")}
                    value={excludedDraft ?? vaultSettings.excludedPaths.join("\n")}
                    onChange={(e) => onExcludedChange(e.target.value)}
                    className="w-full rounded-md border border-ob-border bg-ob-primary px-2 py-1.5 text-[13px] text-ob-text outline-none placeholder:text-ob-faint"
                  />
                </div>
              </section>
            )}

            {tab === "Hotkeys" && (
              <HotkeysTab query={hotkeyQuery} onQuery={setHotkeyQuery} />
            )}

            {tab === "Vault" && (
              <section className="space-y-6">
                <VaultsSection vaultId={vaultId} />
                <div className="space-y-3">
                <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                  {t("settings.sections.dailyNotes")}
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="daily-format">{t("settings.vault.dateFormat")}</Label>
                    <Input
                      id="daily-format"
                      placeholder="YYYY-MM-DD"
                      value={dailyFormat ?? settings.dailyNoteFormat ?? ""}
                      onChange={(e) => setDailyFormat(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="daily-folder">{t("settings.vault.folder")}</Label>
                    <Input
                      id="daily-folder"
                      placeholder="Journal"
                      value={dailyFolder ?? settings.dailyNoteFolder ?? ""}
                      onChange={(e) => setDailyFolder(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="daily-template">{t("settings.vault.templateNotePath")}</Label>
                  <Input
                    id="daily-template"
                    placeholder="Templates/Daily"
                    value={dailyTemplate ?? settings.dailyNoteTemplate ?? ""}
                    onChange={(e) => setDailyTemplate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="templates-folder">{t("settings.vault.templatesFolder")}</Label>
                  <Input
                    id="templates-folder"
                    placeholder="Templates"
                    value={templatesFolder ?? settings.templatesFolder ?? ""}
                    onChange={(e) => setTemplatesFolder(e.target.value)}
                  />
                </div>
                <Button size="sm" onClick={() => saveVault.mutate()} disabled={saveVault.isPending}>
                  {t("settings.vault.saveVaultSettings")}
                </Button>
                </div>
              </section>
            )}

            {tab === "Canvas" && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                  {t("settings.sections.canvas")}
                </h3>
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="canvas-bg" className="font-normal text-ob-muted">
                    {t("settings.canvas.background")}
                    <span className="block text-[11px] font-normal text-ob-faint">
                      {t("settings.canvas.backgroundHint")}
                    </span>
                  </Label>
                  <select
                    id="canvas-bg"
                    aria-label={t("settings.canvas.background")}
                    value={(settings.canvasBackground as string) ?? "dots"}
                    onChange={(e) => saveVaultPatch.mutate({ canvasBackground: e.target.value })}
                    className="rounded-md border border-ob-border bg-ob-primary px-2 py-1 text-[13px] text-ob-text"
                  >
                    <option value="dots">{t("settings.canvas.backgroundDots")}</option>
                    <option value="grid">{t("settings.canvas.backgroundGrid")}</option>
                    <option value="blank">{t("settings.canvas.backgroundBlank")}</option>
                  </select>
                </div>
              </section>
            )}

            {tab === "Publish" && (
              <section className="space-y-3">
                <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                  {t("settings.sections.publishSite")}
                </h3>
                {siteStatus?.enabled && siteStatus.slug ? (
                  <div className="space-y-2">
                    <p className="text-[13px] text-ob-muted">
                      {t("settings.publish.liveAt", { url: `/s/${siteStatus.slug}`, code: "publish: false" })}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => siteToggle.mutate(false)}
                      disabled={siteToggle.isPending}
                    >
                      {t("settings.publish.unpublishSite")}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[13px] text-ob-muted">
                      {t("settings.publish.publishDesc")}
                    </p>
                    <Button
                      size="sm"
                      onClick={() => siteToggle.mutate(true)}
                      disabled={siteToggle.isPending}
                    >
                      {t("settings.publish.publishVault")}
                    </Button>
                  </div>
                )}
              </section>
            )}

            {tab === "Collab" && (
              <section className="space-y-3">
                <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                  {t("settings.sections.liveCollaboration")}
                </h3>
                <label className="flex items-center justify-between gap-2 text-[13px] text-ob-muted">
                  <span>
                    {t("settings.collab.title", { badge: t("settings.collab.beta") })}
                    <span className="block text-[11px] text-ob-faint">
                      {t("settings.collab.hint")}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    aria-label={t("settings.sections.liveCollaboration")}
                    checked={collabDraft ?? Boolean(settings.collabEnabled)}
                    onChange={(e) => {
                      setCollabDraft(e.target.checked);
                      saveCollab.mutate(e.target.checked);
                    }}
                    className="accent-[var(--ob-interactive-accent)]"
                  />
                </label>
              </section>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Searchable, grouped shortcut reference (S12.1) — Obsidian's Hotkeys tab. */
function HotkeysTab({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const { t } = useTranslation();
  const filtered = filterHotkeys(query);
  const groups = HOTKEY_SECTIONS.map((section) => ({
    section,
    rows: filtered.filter((h) => h.section === section),
  })).filter((g) => g.rows.length > 0);

  return (
    <section className="space-y-4">
      <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">{t("settings.sections.hotkeys")}</h3>
      <Input
        aria-label={t("settings.sections.hotkeys")}
        placeholder={t("settings.hotkeys.searchPlaceholder")}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      {groups.length === 0 && <p className="text-[13px] text-ob-faint">{t("settings.hotkeys.noMatch")}</p>}
      {groups.map((g) => (
        <div key={g.section} className="space-y-0.5">
          <div className="px-1 pt-1 text-[11px] font-medium tracking-wide text-ob-faint uppercase">
            {g.section}
          </div>
          {g.rows.map((h) => (
            <div
              key={`${h.section}-${h.keys}-${h.action}`}
              data-hotkey-row
              className="flex items-center justify-between gap-4 rounded px-1 py-1 text-[13px] hover:bg-ob-hover"
            >
              <span className="text-ob-muted">{h.action}</span>
              {h.keys ? (
                <kbd className="shrink-0 rounded border border-ob-border px-1.5 py-0.5 text-[11px] text-ob-faint">
                  {h.keys}
                </kbd>
              ) : (
                <span
                  title="Run from the command palette (⌘P)"
                  className="shrink-0 rounded border border-dashed border-ob-border px-1.5 py-0.5 text-[11px] text-ob-faint/70"
                >
                  ⌘P
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

function FontSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: FontChoice;
  onChange: (value: FontChoice) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id} className="font-normal text-ob-muted">
        {label}
      </Label>
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as FontChoice)}
        className="rounded-md border border-ob-border bg-ob-primary px-2 py-1 text-[13px] text-ob-text"
      >
        {Object.keys(FONT_CHOICES).map((key) => (
          <option key={key} value={key}>
            {key === "default" ? t("settings.appearance.defaultFont") : key}
          </option>
        ))}
      </select>
    </div>
  );
}

function SettingToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[13px] text-ob-muted">
      <span>
        {label}
        <span className="block text-[11px] text-ob-faint">{hint}</span>
      </span>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--ob-interactive-accent)]"
      />
    </label>
  );
}

