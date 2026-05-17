/**
 * Thin wrapper around `marked` for rendering AI-generated markdown content.
 * Also exposes `extractLead()` for showing a short preview before the full body.
 *
 * Markdown here comes from admin/AI sources (course/lesson overviews), not
 * user input — so no sanitization layer (DOMPurify) is wired in. Add one if
 * we ever accept UGC markdown.
 */
import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function renderMarkdown(md: string | undefined | null): string {
  if (!md) return "";
  return marked.parse(md, { async: false }) as string;
}

/**
 * Pull a short "lead" from a markdown blob — what a reader sees before
 * clicking through to the full body. Strategy:
 *   1. Drop a leading H1 (it duplicates the page title).
 *   2. Take everything up to (but not including) the first H2 / next H1.
 *   3. If that's still too long, truncate to ~2 paragraphs.
 *
 * Returns markdown (not HTML) so the caller can decide how to render it.
 */
export function extractLead(md: string | undefined | null): string {
  if (!md) return "";
  const lines = md.replace(/\r\n/g, "\n").split("\n");

  // Skip leading blank lines + an optional H1
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i < lines.length && /^#\s+/.test(lines[i])) {
    i++; // skip the H1 line itself
    while (i < lines.length && lines[i].trim() === "") i++;
  }

  const start = i;
  let end = lines.length;
  for (let j = start; j < lines.length; j++) {
    if (/^(#{1,2})\s+/.test(lines[j])) {
      end = j;
      break;
    }
  }

  const lead = lines.slice(start, end).join("\n").trim();
  if (!lead) return "";

  // Cap at ~2 paragraphs / 600 chars to avoid hero-sized leads.
  const paras = lead.split(/\n{2,}/);
  let out = paras.slice(0, 2).join("\n\n");
  if (out.length > 600) out = out.slice(0, 600).replace(/\s+\S*$/, "") + "…";
  return out;
}

/**
 * True if the markdown has meaningful content beyond what `extractLead`
 * returns — used to decide whether to show a "Read more" affordance.
 */
export function hasMoreThanLead(md: string | undefined | null): boolean {
  if (!md) return false;
  const lead = extractLead(md);
  return md.trim().length > lead.length + 20;
}
