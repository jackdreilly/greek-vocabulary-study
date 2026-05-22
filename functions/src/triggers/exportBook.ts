/**
 * EPUB export pipeline (Firestore-as-bus).
 *
 * The client drops a job doc into `book_exports/{exportId}` with a scope
 * (a whole course, or a single lesson). This trigger picks it up, loads the
 * course/lesson content, builds a nested-chapter EPUB3 book, uploads it to
 * Cloud Storage, and writes a download URL back onto the job doc. The client
 * subscribes to the job and downloads when `status === "completed"`.
 *
 * Pattern mirrors the working exporter in ~/Documents/fanariotes.
 */
import { randomUUID } from "node:crypto";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

// Lazy: index.ts calls initializeApp() in its module body, but ES import
// hoisting runs this module first — so resolve Firestore on first use.
let _db: Firestore | undefined;
function db(): Firestore {
  if (!_db) _db = getFirestore();
  return _db;
}

type ExportStatus = "pending" | "in_progress" | "completed" | "failed";

type BookExportJob = {
  scope?: "course" | "lesson";
  courseId?: string;
  lessonId?: string;
  status?: ExportStatus | "";
  title?: string;
  requestedAt?: number;
  completedAt?: number;
  downloadUrl?: string;
  storagePath?: string;
  error?: string;
  [key: string]: unknown;
};

// ─── Firestore document shapes (loose; we only read a subset) ──────────────

type CourseData = {
  title?: string;
  subtitle?: string;
  description?: string;
};

type LessonData = {
  id: string;
  title?: string;
  subtitle?: string;
  description?: string;
  order?: number;
};

type EntryData = {
  lemma?: string;
  article?: string;
  english?: string;
  senses?: string[];
  examples?: Array<{ el?: string; en?: string }>;
  category?: string;
  order?: number;
};

type GameData = {
  type?: string;
  title?: string;
  prompt?: string;
  question?: string;
  passage?: string;
  expectedAnswer?: string;
  acceptableAnswers?: string[];
  rubric?: string;
  direction?: string;
};

type Widget = Record<string, unknown> & { type?: string };

type PlanData = {
  planNumber?: number;
  title?: string;
  subtitle?: string;
  widgets?: Widget[];
};

type LessonBundle = {
  lesson: LessonData;
  entries: EntryData[];
  plans: PlanData[];
  games: GameData[];
};

// ─── XHTML helpers ─────────────────────────────────────────────────────────

function escapeXml(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function slugify(text: unknown): string {
  return (
    String(text ?? "")
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "section"
  );
}

/** Minimal markdown → well-formed XHTML (headings, lists, tables, bold/italic). */
function markdownToXhtml(markdown: unknown): string {
  const lines = String(markdown ?? "").replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let inList = false;
  let inTable = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  const closeTable = () => {
    if (inTable) {
      out.push("</tbody></table>");
      inTable = false;
    }
  };
  const inline = (text: string): string =>
    escapeXml(text)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      closeList();
      closeTable();
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = trimmed.match(/^(#{1,4})\s+(.*)$/))) {
      closeList();
      closeTable();
      const level = Math.min(m[1].length + 1, 5); // h1 in source → h2 in book
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      closeTable();
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(trimmed.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (trimmed.startsWith("|")) {
      closeList();
      const cells = trimmed
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      const isSeparator = cells.every((c) => /^[:\-\s]+$/.test(c) && c.includes("-"));
      if (isSeparator) {
        if (!inTable) {
          out.push('<table class="grid"><tbody>');
          inTable = true;
        }
        continue;
      }
      if (!inTable) {
        out.push('<table class="grid"><thead><tr>');
        cells.forEach((c) => out.push(`<th>${inline(c)}</th>`));
        out.push("</tr></thead><tbody>");
        inTable = true;
      } else {
        out.push("<tr>");
        cells.forEach((c) => out.push(`<td>${inline(c)}</td>`));
        out.push("</tr>");
      }
      continue;
    }
    closeList();
    closeTable();
    out.push(`<p>${inline(trimmed)}</p>`);
  }
  closeList();
  closeTable();
  return out.join("\n");
}

// ─── Content renderers ───────────────────────────────────────────────────────

function renderVocab(entries: EntryData[]): string {
  if (!entries.length) return "<p>No vocabulary in this lesson yet.</p>";
  const items = entries.map((e) => {
    const head = [e.article, e.lemma].filter(Boolean).map(escapeXml).join(" ");
    const senses = (e.senses ?? []).filter(Boolean);
    const extraSenses = senses.length > 1 ? senses.slice(1) : [];
    const parts: string[] = [
      `<p class="lex-head"><strong>${head}</strong> — ${escapeXml(e.english || senses[0] || "")}</p>`,
    ];
    if (extraSenses.length) {
      parts.push(`<p class="lex-note">also: ${escapeXml(extraSenses.join("; "))}</p>`);
    }
    for (const ex of e.examples ?? []) {
      if (!ex?.el && !ex?.en) continue;
      parts.push(
        `<p class="lex-ex"><span class="el">${escapeXml(ex.el || "")}</span>` +
          (ex.en ? ` <span class="en">— ${escapeXml(ex.en)}</span>` : "") +
          `</p>`,
      );
    }
    return `<div class="lex-entry">${parts.join("")}</div>`;
  });
  return `<div class="lex-list">${items.join("\n")}</div>`;
}

function renderWidget(w: Widget): string {
  const type = String(w.type ?? "");
  const md = (v: unknown) => markdownToXhtml(v);
  const str = (v: unknown) => escapeXml(v);

  switch (type) {
    case "heading": {
      const level = Math.min(Math.max(Number(w.level ?? 2), 1), 3) + 1; // h2..h4
      return `<h${level}>${str(w.text)}</h${level}>`;
    }
    case "prose":
      return md(w.markdown);
    case "markdown":
      return (w.title ? `<h3>${str(w.title)}</h3>` : "") + md(w.markdown);
    case "callout": {
      const kind = str(w.calloutKind || "note");
      const title = w.title ? `<p class="callout-title">${str(w.title)}</p>` : "";
      return `<div class="callout"><p class="callout-kind">${kind}</p>${title}${md(w.markdown)}</div>`;
    }
    case "vocab_table": {
      const rows = (w.rows as Array<Record<string, unknown>>) ?? [];
      const body = rows
        .map(
          (r) =>
            `<tr><td class="el">${str([r.article, r.el].filter(Boolean).join(" "))}</td>` +
            `<td>${str(r.en)}</td>` +
            `<td class="el">${str(r.example ?? "")}</td></tr>`,
        )
        .join("");
      return `<table class="grid"><thead><tr><th>Greek</th><th>English</th><th>Example</th></tr></thead><tbody>${body}</tbody></table>`;
    }
    case "conjugation_table":
    case "comparison_table": {
      const headers = (w.headers as string[]) ?? [];
      const head = headers.map((h) => `<th>${str(h)}</th>`).join("");
      let body = "";
      if (type === "conjugation_table") {
        const rows = (w.rows as Array<{ form?: string; cells?: string[] }>) ?? [];
        body = rows
          .map(
            (r) =>
              `<tr><th class="row-label">${str(r.form)}</th>` +
              (r.cells ?? []).map((c) => `<td class="el">${str(c)}</td>`).join("") +
              `</tr>`,
          )
          .join("");
      } else {
        const rows = (w.rows as string[][]) ?? [];
        body = rows
          .map((row) => `<tr>${row.map((c) => `<td>${str(c)}</td>`).join("")}</tr>`)
          .join("");
      }
      return `<table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
    case "reading_passage": {
      const glossary = (w.glossary as Array<{ el?: string; en?: string }>) ?? [];
      const gloss = glossary.length
        ? `<ul class="glossary">${glossary
            .map((g) => `<li><span class="el">${str(g.el)}</span> — ${str(g.en)}</li>`)
            .join("")}</ul>`
        : "";
      return (
        `<div class="passage">` +
        md(w.el) +
        (w.en ? `<div class="passage-en">${md(w.en)}</div>` : "") +
        gloss +
        `</div>`
      );
    }
    case "dialogue": {
      const lines = (w.lines as Array<{ speaker?: string; el?: string; en?: string }>) ?? [];
      return (
        `<div class="dialogue">` +
        lines
          .map(
            (l) =>
              `<p class="dlg-line"><span class="dlg-speaker">${str(l.speaker)}:</span> ` +
              `<span class="el">${str(l.el)}</span>` +
              (l.en ? ` <span class="en">— ${str(l.en)}</span>` : "") +
              `</p>`,
          )
          .join("") +
        `</div>`
      );
    }
    case "mini_quiz": {
      const items = (w.items as Array<Record<string, unknown>>) ?? [];
      return items
        .map((it, i) => {
          const opts = (it.options as string[]) ?? [];
          let correct = Number(it.correctIndex ?? -1);
          if (!(correct >= 0 && correct < opts.length) && it.answer) {
            correct = opts.findIndex((o) => o === it.answer);
          }
          const lis = opts
            .map(
              (o, j) =>
                `<li>${j === correct ? "<strong>" : ""}${str(o)}${j === correct ? " ✓</strong>" : ""}</li>`,
            )
            .join("");
          const why = it.explanation ? `<p class="quiz-why">${str(it.explanation)}</p>` : "";
          return `<div class="quiz-q"><p class="quiz-prompt">${i + 1}. ${str(it.q)}</p><ol class="quiz-opts">${lis}</ol>${why}</div>`;
        })
        .join("");
    }
    case "fill_in_blanks": {
      const items = (w.items as Array<Record<string, unknown>>) ?? [];
      const intro = w.instructions ? `<p class="fib-intro">${str(w.instructions)}</p>` : "";
      const lis = items
        .map((it) => {
          const hint = it.hint ? ` <span class="fib-hint">(${str(it.hint)})</span>` : "";
          const en = it.english ? `<span class="en"> — ${str(it.english)}</span>` : "";
          const answer = it.answer
            ? `<br/><span class="fib-answer">Answer: ${str(it.answer)}</span>`
            : "";
          return `<li><span class="el">${str(it.sentence)}</span>${hint}${answer}${en}</li>`;
        })
        .join("");
      return `${intro}<ol class="fib-list">${lis}</ol>`;
    }
    case "word_tree": {
      // Persisted widgets vary: newer ones use `root`, older ones the raw
      // generation shape `rootEl`/`rootEn`.
      const root = (w.root as { el?: string; en?: string }) ?? {};
      const rootEl = root.el || (w.rootEl as string) || "";
      const rootEn = root.en || (w.rootEn as string) || "";
      const branches = (w.branches as Array<{ el?: string; en?: string; relation?: string }>) ?? [];
      const lis = branches
        .map(
          (b) =>
            `<li><span class="el">${str(b.el)}</span> — ${str(b.en)}` +
            (b.relation ? ` <span class="tree-rel">(${str(b.relation)})</span>` : "") +
            `</li>`,
        )
        .join("");
      const rootLine =
        rootEl || rootEn
          ? `<p class="tree-root"><strong class="el">${str(rootEl)}</strong> — ${str(rootEn)}</p>`
          : "";
      return `<div class="word-tree">${rootLine}<ul>${lis}</ul></div>`;
    }
    default:
      return "";
  }
}

function renderPlanBody(plan: PlanData): string {
  const widgets = plan.widgets ?? [];
  if (!widgets.length) return "<p>This plan has no content yet.</p>";
  return widgets.map(renderWidget).filter(Boolean).join("\n");
}

function renderGames(games: GameData[]): string {
  if (!games.length) return "<p>No practice exercises in this lesson yet.</p>";
  return games
    .map((g, i) => {
      const parts: string[] = [
        `<h3>${escapeXml(g.title || g.type || `Exercise ${i + 1}`)}</h3>`,
      ];
      if (g.passage) parts.push(`<div class="passage el">${markdownToXhtml(g.passage)}</div>`);
      if (g.prompt) parts.push(`<p class="game-prompt">${escapeXml(g.prompt)}</p>`);
      if (g.question) parts.push(`<p class="game-q">${escapeXml(g.question)}</p>`);
      const answers = [g.expectedAnswer, ...(g.acceptableAnswers ?? [])].filter(Boolean);
      if (answers.length) {
        parts.push(
          `<p class="game-answer">Answer: <span class="el">${escapeXml(answers.join(" / "))}</span></p>`,
        );
      }
      if (g.rubric) parts.push(`<p class="game-rubric">${escapeXml(g.rubric)}</p>`);
      return `<div class="game">${parts.join("\n")}</div>`;
    })
    .join("\n");
}

// ─── EPUB assembly ───────────────────────────────────────────────────────────

type Chapter = {
  id: string;
  title: string;
  body: string;
  children?: Chapter[];
};

function lessonChapter(bundle: LessonBundle, idPrefix: string): Chapter {
  const { lesson, entries, plans, games } = bundle;
  const children: Chapter[] = [];

  children.push({
    id: `${idPrefix}-overview`,
    title: "Overview",
    body: lesson.description?.trim()
      ? markdownToXhtml(lesson.description)
      : "<p>No overview generated yet.</p>",
  });
  children.push({
    id: `${idPrefix}-vocab`,
    title: "Vocabulary",
    body: renderVocab(entries),
  });
  if (plans.length) {
    children.push({
      id: `${idPrefix}-plans`,
      title: "Study plans",
      body: `<p>${plans.length} study ${plans.length === 1 ? "module" : "modules"} for this lesson.</p>`,
      children: plans.map((p, i) => ({
        id: `${idPrefix}-plan-${i + 1}`,
        title: p.title || `Plan ${p.planNumber ?? i + 1}`,
        body:
          (p.subtitle ? `<p class="plan-subtitle">${escapeXml(p.subtitle)}</p>` : "") +
          renderPlanBody(p),
      })),
    });
  }
  children.push({
    id: `${idPrefix}-games`,
    title: "Practice",
    body: renderGames(games),
  });

  const subtitle = lesson.subtitle ? `<p class="lesson-subtitle">${escapeXml(lesson.subtitle)}</p>` : "";
  return {
    id: idPrefix,
    title: lesson.title || "Lesson",
    body: `<h1>${escapeXml(lesson.title || "Lesson")}</h1>${subtitle}`,
    children,
  };
}

function epubStylesheet(): string {
  // Black-and-white, reflowable; tuned for e-ink (Kindle).
  return `body { font-family: Georgia, 'Times New Roman', serif; line-height: 1.5; margin: 0 5%; }
h1 { font-size: 1.6em; margin: 0.8em 0 0.4em; }
h2 { font-size: 1.3em; margin: 1.2em 0 0.4em; border-bottom: 1px solid #999; padding-bottom: 0.2em; }
h3 { font-size: 1.1em; margin: 1em 0 0.3em; }
h4 { font-size: 1em; margin: 0.9em 0 0.3em; }
p { margin: 0.6em 0; }
ul, ol { padding-left: 1.3em; margin: 0.6em 0; }
li { margin: 0.3em 0; }
strong { font-weight: 700; } em { font-style: italic; }
code { font-family: monospace; }
.el { font-weight: 600; }
.en { font-style: italic; }
table.grid { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.95em; }
table.grid th, table.grid td { border-bottom: 1px solid #999; padding: 0.4em 0.5em; text-align: left; vertical-align: top; }
table.grid th { text-transform: uppercase; font-size: 0.75em; letter-spacing: 0.06em; border-bottom: 2px solid #000; }
.row-label { font-weight: 600; }
.lex-entry { padding: 0.5em 0; border-bottom: 1px solid #ccc; }
.lex-head { margin: 0; } .lex-note { margin: 0.1em 0; font-size: 0.9em; }
.lex-ex { margin: 0.2em 0 0; font-size: 0.95em; }
.callout { border-left: 3px solid #000; padding: 0.2em 0 0.2em 0.8em; margin: 1em 0; }
.callout-kind { text-transform: uppercase; font-size: 0.7em; letter-spacing: 0.12em; margin: 0; }
.callout-title { font-weight: 700; margin: 0.2em 0; }
.dlg-speaker { font-weight: 700; } .dlg-line { margin: 0.4em 0; }
.passage-en { font-style: italic; margin-top: 0.6em; }
.glossary { font-size: 0.9em; }
.quiz-q { margin: 0.9em 0; } .quiz-opts { list-style: lower-alpha; }
.quiz-why { font-size: 0.9em; } .fib-hint { font-style: italic; font-size: 0.9em; }
.fib-answer { font-size: 0.9em; } .tree-rel { font-style: italic; font-size: 0.85em; }
.game { margin: 1.2em 0; } .game-answer { font-size: 0.95em; }
.lesson-subtitle, .plan-subtitle { font-style: italic; color: #333; }
nav.toc a { text-decoration: none; }`;
}

function flatten(chapters: Chapter[]): Chapter[] {
  const out: Chapter[] = [];
  const walk = (list: Chapter[]) => {
    for (const c of list) {
      out.push(c);
      if (c.children?.length) walk(c.children);
    }
  };
  walk(chapters);
  return out;
}

function navList(chapters: Chapter[]): string {
  const render = (list: Chapter[]): string =>
    `<ol>${list
      .map(
        (c) =>
          `<li><a href="${c.id}.xhtml">${escapeXml(c.title)}</a>` +
          (c.children?.length ? render(c.children) : "") +
          `</li>`,
      )
      .join("")}</ol>`;
  return render(chapters);
}

async function buildEpub(opts: {
  title: string;
  identifier: string;
  intro?: { title: string; body: string };
  chapters: Chapter[];
}): Promise<Buffer> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.folder("META-INF")?.file(
    "container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  const oebps = zip.folder("OEBPS");
  if (!oebps) throw new Error("Could not create OEBPS folder.");
  oebps.file("styles.css", epubStylesheet());

  const manifest: string[] = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="css" href="styles.css" media-type="text/css"/>`,
  ];
  const spine: string[] = [];

  const allChapters: Chapter[] = [];
  if (opts.intro) {
    allChapters.push({ id: "intro", title: opts.intro.title, body: opts.intro.body });
  }
  allChapters.push(...opts.chapters);

  for (const ch of flatten(allChapters)) {
    const fileName = `${ch.id}.xhtml`;
    oebps.file(
      fileName,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>${escapeXml(ch.title)}</title>
    <link rel="stylesheet" type="text/css" href="styles.css"/>
  </head>
  <body>
${ch.body}
  </body>
</html>`,
    );
    manifest.push(`<item id="${ch.id}" href="${fileName}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${ch.id}"/>`);
  }

  oebps.file(
    "nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <title>Contents</title>
    <link rel="stylesheet" type="text/css" href="styles.css"/>
  </head>
  <body>
    <nav epub:type="toc" id="toc" class="toc">
      <h1>Contents</h1>
      ${navList(allChapters)}
    </nav>
  </body>
</html>`,
  );

  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  oebps.file(
    "content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(opts.identifier)}</dc:identifier>
    <dc:title>${escapeXml(opts.title)}</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>Greekflash</dc:creator>
    <meta property="dcterms:modified">${nowIso}</meta>
  </metadata>
  <manifest>
    ${manifest.join("\n    ")}
  </manifest>
  <spine>
    ${spine.join("\n    ")}
  </spine>
</package>`,
  );

  return zip.generateAsync({ type: "nodebuffer", mimeType: "application/epub+zip" });
}

// ─── Data loading ────────────────────────────────────────────────────────────

async function loadLessonBundle(courseId: string, lessonId: string, lesson: LessonData): Promise<LessonBundle> {
  const lessonRef = db().collection("courses").doc(courseId).collection("lessons").doc(lessonId);
  const [entriesSnap, plansSnap, gamesSnap] = await Promise.all([
    lessonRef.collection("entries").orderBy("order").get(),
    lessonRef.collection("plans").orderBy("planNumber").get(),
    lessonRef.collection("games").get(),
  ]);
  return {
    lesson,
    entries: entriesSnap.docs.map((d) => d.data() as EntryData),
    plans: plansSnap.docs
      .map((d) => d.data() as PlanData)
      .filter((p) => (p.widgets?.length ?? 0) > 0),
    games: gamesSnap.docs.map((d) => d.data() as GameData),
  };
}

// ─── Storage ─────────────────────────────────────────────────────────────────

function getBucket() {
  const projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_CONFIG?.match(/"projectId":"([^"]+)"/)?.[1] ||
    "";
  if (!projectId) throw new Error("Could not resolve Firebase project ID for Cloud Storage.");
  return getStorage().bucket(`${projectId}.firebasestorage.app`);
}

function downloadUrlFor(bucketName: string, objectPath: string, token: string): string {
  const encoded = encodeURIComponent(objectPath);
  const host =
    process.env.FUNCTIONS_EMULATOR === "true"
      ? "http://127.0.0.1:9199"
      : "https://firebasestorage.googleapis.com";
  return `${host}/v0/b/${bucketName}/o/${encoded}?alt=media&token=${token}`;
}

async function cleanupOldExports(retentionMs = 24 * 60 * 60 * 1000): Promise<void> {
  const cutoff = Date.now() - retentionMs;
  const snap = await db().collection("book_exports").get();
  const stale = snap.docs.filter((doc) => {
    const data = (doc.data() || {}) as BookExportJob;
    if (data.status === "pending" || data.status === "in_progress") return false;
    const anchor = Number(data.completedAt || data.requestedAt || 0);
    return Boolean(anchor && anchor < cutoff);
  });
  if (!stale.length) return;
  await Promise.all(
    stale.map(async (doc) => {
      const data = (doc.data() || {}) as BookExportJob;
      const path = String(data.storagePath || "").trim();
      if (path) {
        await getBucket()
          .file(path)
          .delete()
          .catch(() => undefined);
      }
      await doc.ref.delete();
    }),
  );
  logger.info("exportBook: cleaned up stale exports", { count: stale.length });
}

// ─── Trigger ─────────────────────────────────────────────────────────────────

function shouldRun(job: BookExportJob | null | undefined): boolean {
  return Boolean(
    job &&
      job.status === "pending" &&
      (job.scope === "course" || job.scope === "lesson") &&
      job.courseId,
  );
}

export const exportBook = onDocumentWritten(
  { document: "book_exports/{exportId}", region: "us-central1", timeoutSeconds: 540, memory: "1GiB" },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const exportId = event.params.exportId;
    const job = after.data() as BookExportJob;
    if (!shouldRun(job)) return;

    const exportRef = db().collection("book_exports").doc(exportId);
    const locked = await db().runTransaction(async (tx) => {
      const fresh = await tx.get(exportRef);
      if (!shouldRun(fresh.exists ? (fresh.data() as BookExportJob) : null)) return false;
      tx.set(
        exportRef,
        { status: "in_progress", error: "", downloadUrl: "", storagePath: "" },
        { merge: true },
      );
      return true;
    });
    if (!locked) return;

    logger.info("exportBook: starting", { exportId, scope: job.scope, courseId: job.courseId });
    try {
      const courseId = String(job.courseId);
      const courseSnap = await db().collection("courses").doc(courseId).get();
      if (!courseSnap.exists) throw new Error("Course not found.");
      const course = courseSnap.data() as CourseData;

      let epub: Buffer;
      let bookTitle: string;
      let filenameStem: string;

      if (job.scope === "lesson") {
        const lessonId = String(job.lessonId || "");
        const lessonSnap = await db()
          .collection("courses")
          .doc(courseId)
          .collection("lessons")
          .doc(lessonId)
          .get();
        if (!lessonSnap.exists) throw new Error("Lesson not found.");
        const lesson = { ...(lessonSnap.data() as LessonData), id: lessonSnap.id };
        const bundle = await loadLessonBundle(courseId, lessonId, lesson);
        bookTitle = `${course.title || "Greek"} — ${lesson.title || "Lesson"}`;
        filenameStem = slugify(`${course.title || "course"}-${lesson.title || "lesson"}`);
        const top = lessonChapter(bundle, "lesson");
        epub = await buildEpub({
          title: bookTitle,
          identifier: `greekflash-${courseId}-${lessonId}`,
          chapters: top.children ?? [],
        });
      } else {
        const lessonsSnap = await db()
          .collection("courses")
          .doc(courseId)
          .collection("lessons")
          .orderBy("order")
          .get();
        const lessons = lessonsSnap.docs.map((d) => ({ ...(d.data() as LessonData), id: d.id }));
        const bundles = await Promise.all(
          lessons.map((l) => loadLessonBundle(courseId, l.id, l)),
        );
        bookTitle = course.title || "Greek Course";
        filenameStem = slugify(course.title || "greek-course");
        epub = await buildEpub({
          title: bookTitle,
          identifier: `greekflash-${courseId}`,
          intro: {
            title: bookTitle,
            body:
              `<h1>${escapeXml(bookTitle)}</h1>` +
              (course.subtitle ? `<p class="lesson-subtitle">${escapeXml(course.subtitle)}</p>` : "") +
              (course.description ? markdownToXhtml(course.description) : "") +
              `<p>${lessons.length} ${lessons.length === 1 ? "lesson" : "lessons"}.</p>`,
          },
          chapters: bundles.map((b, i) => lessonChapter(b, `l${i + 1}`)),
        });
      }

      const stamp = new Date().toISOString().slice(0, 10);
      const fileName = `${filenameStem}-${stamp}.epub`;
      const storagePath = `book-exports/${exportId}/${fileName}`;
      const bucket = getBucket();
      const file = bucket.file(storagePath);
      const token = randomUUID();
      await file.save(epub, {
        resumable: false,
        contentType: "application/epub+zip",
        metadata: {
          cacheControl: "private, max-age=0, no-transform",
          contentDisposition: `attachment; filename="${fileName}"`,
          metadata: { firebaseStorageDownloadTokens: token },
        },
      });

      await exportRef.set(
        {
          status: "completed",
          completedAt: Date.now(),
          downloadUrl: downloadUrlFor(bucket.name, storagePath, token),
          storagePath,
          fileName,
          error: "",
        },
        { merge: true },
      );
      await cleanupOldExports().catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("exportBook: failed", { exportId, error: message });
      await exportRef.set(
        { status: "failed", completedAt: Date.now(), error: message },
        { merge: true },
      );
    }
  },
);
