"use client";

/** Status bar — Obsidian's bottom-right pill: backlinks · words · characters. */

import { useQuery } from "@tanstack/react-query";

import { linkApi, noteApi } from "@/lib/api/endpoints";
import { useTranslation } from "@/lib/i18n";

export function StatusBar({ vaultId, noteId }: { vaultId: string; noteId: string | null }) {
  const { t } = useTranslation();
  const { data: note } = useQuery({
    queryKey: ["note", vaultId, noteId],
    queryFn: () => noteApi.get(vaultId, noteId as string),
    enabled: Boolean(noteId),
  });
  const { data: backlinks } = useQuery({
    queryKey: ["backlinks", vaultId, noteId],
    queryFn: () => linkApi.backlinks(vaultId, noteId as string),
    enabled: Boolean(noteId),
  });

  if (!noteId || !note) return null;

  const words = note.content.trim() ? note.content.trim().split(/\s+/).length : 0;
  const chars = note.content.length;
  const backlinkCount = backlinks?.backlinks.length ?? 0;

  return (
    <div className="pointer-events-none absolute right-0 bottom-0 z-20 flex items-center gap-3 rounded-tl-lg border-t border-l border-ob-border bg-ob-sidebar px-3 py-1 text-[12px] text-ob-faint">
      <span>
        {t(backlinkCount === 1 ? "statusBar.backlink_one" : "statusBar.backlink_other", { count: backlinkCount })}
      </span>
      <span>{t(words === 1 ? "statusBar.words_one" : "statusBar.words_other", { count: words })}</span>
      <span>{t(chars === 1 ? "statusBar.characters_one" : "statusBar.characters_other", { count: chars })}</span>
    </div>
  );
}
