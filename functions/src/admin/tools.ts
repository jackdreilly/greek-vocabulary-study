/**
 * Admin chat tools — Genkit `defineTool` registrations consumed by
 * `yiayiaAdminChat`. Each tool either reads slim views of the Firestore
 * tree, kicks off a stub doc that the existing triggers pick up, or
 * patches/deletes content with cascade-aware helpers and lineage tracking.
 *
 * Design notes:
 *   - Every write tool returns `generationId` so the chat UI can offer a
 *     one-click revert.
 *   - Input/output schemas stay flat-ish to keep Gemini's
 *     legacyResponseSchema happy.
 *   - Read tools cap returned data aggressively to avoid blowing the
 *     model's context window.
 */
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { z } from "genkit";
import type { ToolAction } from "genkit";
import { getAI } from "../ai/genkitClient.js";
import {
  CascadeCounts,
  deleteCourseCascade,
  deleteEntryDoc,
  deleteGameDoc,
  deleteLessonCascade,
  deletePlanDoc,
  rebuildCourseCounts,
  rebuildLessonCounts,
  removeLessonSummary,
} from "./cascade.js";
import { LineageRecorder } from "./lineage.js";
import { textMatchesSearch } from "./search.js";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function slugify(input: string, fallback = "item"): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

function status(message: string) {
  return { at: Timestamp.now(), message, source: "system" };
}

function compactDoc(data: FirebaseFirestore.DocumentData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v == null) continue;
    if (typeof v === "string" && v.length > 600) {
      out[k] = `${v.slice(0, 600)}…`;
      continue;
    }
    if (Array.isArray(v) && v.length > 20) {
      out[k] = `[${v.length} items]`;
      continue;
    }
    if (k === "statusLog") continue; // too noisy
    if (k === "createdAt" || k === "updatedAt" || k === "completedAt") continue;
    out[k] = v;
  }
  return out;
}

function counts(cc: CascadeCounts): Record<string, number> {
  const result: Record<string, number> = {};
  if (cc.courses) result.courses = cc.courses;
  if (cc.lessons) result.lessons = cc.lessons;
  if (cc.entries) result.entries = cc.entries;
  if (cc.plans) result.plans = cc.plans;
  if (cc.games) result.games = cc.games;
  return result;
}

// ----------------------------------------------------------------------------
// READ TOOLS
// ----------------------------------------------------------------------------

const listCoursesTool = () =>
  getAI().defineTool(
    {
      name: "listCourses",
      description:
        "List GreekFlash courses. Use to find a course by partial title or to enumerate everything in the catalog. Returns ids, titles, status, and counts.",
      inputSchema: z.object({
        query: z.string().optional().default(""),
        limit: z.number().int().min(1).max(40).optional().default(20),
      }),
      outputSchema: z.object({
        count: z.number(),
        courses: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            subtitle: z.string(),
            status: z.string(),
            counts: z.record(z.string(), z.number()),
            sourcePrompt: z.string(),
          }),
        ),
      }),
    },
    async ({ query, limit }) => {
      const snap = await getFirestore().collection("courses").limit(200).get();
      const needle = (query ?? "").trim();
      const cap = limit ?? 20;
      const all = snap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          title: String(data.title ?? doc.id),
          subtitle: String(data.subtitle ?? ""),
          status: String(data.status ?? "ready"),
          counts: {
            lessons: Number(data.counts?.lessons ?? 0),
            entries: Number(data.counts?.entries ?? 0),
            plans: Number(data.counts?.plans ?? 0),
            games: Number(data.counts?.games ?? 0),
          },
          sourcePrompt: String(data.sourcePrompt ?? "").slice(0, 240),
        };
      });
      const filtered = needle
        ? all.filter((c) =>
            textMatchesSearch(
              `${c.id} ${c.title} ${c.subtitle} ${c.sourcePrompt}`,
              needle,
            ),
          )
        : all;
      return { count: filtered.length, courses: filtered.slice(0, cap) };
    },
  );

const listLessonsTool = () =>
  getAI().defineTool(
    {
      name: "listLessons",
      description:
        "List lessons inside a course, ordered by `order`. Returns ids, titles, subtitles, status, and counts.",
      inputSchema: z.object({
        courseId: z.string(),
        limit: z.number().int().min(1).max(60).optional().default(40),
      }),
      outputSchema: z.object({
        courseId: z.string(),
        count: z.number(),
        lessons: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            subtitle: z.string(),
            order: z.number(),
            status: z.string(),
            counts: z.record(z.string(), z.number()),
          }),
        ),
      }),
    },
    async ({ courseId, limit }) => {
      const cap = limit ?? 40;
      const snap = await getFirestore()
        .collection(`courses/${courseId}/lessons`)
        .orderBy("order")
        .limit(cap)
        .get();
      const lessons = snap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          title: String(data.title ?? doc.id),
          subtitle: String(data.subtitle ?? ""),
          order: Number(data.order ?? 0),
          status: String(data.status ?? "ready"),
          counts: {
            entries: Number(data.counts?.entries ?? 0),
            plans: Number(data.counts?.plans ?? 0),
            games: Number(data.counts?.games ?? 0),
          },
        };
      });
      return { courseId, count: lessons.length, lessons };
    },
  );

const getCourseTool = () =>
  getAI().defineTool(
    {
      name: "getCourse",
      description:
        "Read full metadata for a course: title, description, source prompt, status, counts.",
      inputSchema: z.object({ courseId: z.string() }),
      outputSchema: z.object({
        found: z.boolean(),
        course: z.record(z.string(), z.any()).optional(),
      }),
    },
    async ({ courseId }) => {
      const snap = await getFirestore().doc(`courses/${courseId}`).get();
      if (!snap.exists) return { found: false };
      return { found: true, course: compactDoc(snap.data() ?? {}) };
    },
  );

const getLessonTool = () =>
  getAI().defineTool(
    {
      name: "getLesson",
      description:
        "Read a lesson's metadata, description, and overview widgets. Does NOT return entries/plans/games — use the list tools for those.",
      inputSchema: z.object({ courseId: z.string(), lessonId: z.string() }),
      outputSchema: z.object({
        found: z.boolean(),
        lesson: z.record(z.string(), z.any()).optional(),
      }),
    },
    async ({ courseId, lessonId }) => {
      const snap = await getFirestore()
        .doc(`courses/${courseId}/lessons/${lessonId}`)
        .get();
      if (!snap.exists) return { found: false };
      return { found: true, lesson: compactDoc(snap.data() ?? {}) };
    },
  );

const listEntriesTool = () =>
  getAI().defineTool(
    {
      name: "listEntries",
      description:
        "List vocabulary entries for a lesson, optionally filtered by query against lemma/english/category.",
      inputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        query: z.string().optional().default(""),
        limit: z.number().int().min(1).max(80).optional().default(40),
      }),
      outputSchema: z.object({
        count: z.number(),
        entries: z.array(
          z.object({
            id: z.string(),
            lemma: z.string(),
            article: z.string(),
            english: z.string(),
            senses: z.array(z.string()),
            category: z.string(),
            generationId: z.string(),
          }),
        ),
      }),
    },
    async ({ courseId, lessonId, query, limit }) => {
      const cap = limit ?? 40;
      const snap = await getFirestore()
        .collection(`courses/${courseId}/lessons/${lessonId}/entries`)
        .orderBy("order")
        .limit(200)
        .get();
      const needle = (query ?? "").trim();
      const all = snap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          lemma: String(data.lemma ?? ""),
          article: String(data.article ?? ""),
          english: String(data.english ?? ""),
          senses: Array.isArray(data.senses) ? data.senses.map((s: unknown) => String(s)) : [],
          category: String(data.category ?? ""),
          generationId: String(data.generationId ?? ""),
        };
      });
      const filtered = needle
        ? all.filter((e) =>
            textMatchesSearch(`${e.lemma} ${e.english} ${e.category}`, needle),
          )
        : all;
      return { count: filtered.length, entries: filtered.slice(0, cap) };
    },
  );

const listGamesTool = () =>
  getAI().defineTool(
    {
      name: "listGames",
      description: "List practice games for a lesson with type and prompt previews.",
      inputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        limit: z.number().int().min(1).max(60).optional().default(40),
      }),
      outputSchema: z.object({
        count: z.number(),
        games: z.array(
          z.object({
            id: z.string(),
            type: z.string(),
            title: z.string(),
            prompt: z.string(),
            expectedAnswer: z.string(),
            requiredWords: z.array(z.string()),
            generationId: z.string(),
          }),
        ),
      }),
    },
    async ({ courseId, lessonId, limit }) => {
      const cap = limit ?? 40;
      const snap = await getFirestore()
        .collection(`courses/${courseId}/lessons/${lessonId}/games`)
        .limit(cap)
        .get();
      const games = snap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          type: String(data.type ?? ""),
          title: String(data.title ?? ""),
          prompt: String(data.prompt ?? "").slice(0, 240),
          expectedAnswer: String(data.expectedAnswer ?? "").slice(0, 180),
          requiredWords: Array.isArray(data.requiredWords)
            ? data.requiredWords.map((w: unknown) => String(w)).slice(0, 8)
            : [],
          generationId: String(data.generationId ?? ""),
        };
      });
      return { count: games.length, games };
    },
  );

const listPlansTool = () =>
  getAI().defineTool(
    {
      name: "listPlans",
      description: "List plans (textbook modules) for a lesson.",
      inputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        limit: z.number().int().min(1).max(40).optional().default(20),
      }),
      outputSchema: z.object({
        count: z.number(),
        plans: z.array(
          z.object({
            id: z.string(),
            planNumber: z.number(),
            title: z.string(),
            subtitle: z.string(),
            status: z.string(),
            estimatedMinutes: z.number(),
            widgetCount: z.number(),
            coveredConcepts: z.array(z.string()),
            generationId: z.string(),
          }),
        ),
      }),
    },
    async ({ courseId, lessonId, limit }) => {
      const cap = limit ?? 20;
      const snap = await getFirestore()
        .collection(`courses/${courseId}/lessons/${lessonId}/plans`)
        .orderBy("planNumber")
        .limit(cap)
        .get();
      const plans = snap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          planNumber: Number(data.planNumber ?? 0),
          title: String(data.title ?? ""),
          subtitle: String(data.subtitle ?? ""),
          status: String(data.status ?? ""),
          estimatedMinutes: Number(data.estimatedMinutes ?? 0),
          widgetCount: Array.isArray(data.widgets) ? data.widgets.length : 0,
          coveredConcepts: Array.isArray(data.coveredConcepts)
            ? data.coveredConcepts.map((c: unknown) => String(c)).slice(0, 8)
            : [],
          generationId: String(data.generationId ?? ""),
        };
      });
      return { count: plans.length, plans };
    },
  );

const getPlanTool = () =>
  getAI().defineTool(
    {
      name: "getPlan",
      description:
        "Read a single plan, including widget types and a short preview of each widget's content.",
      inputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        planId: z.string(),
      }),
      outputSchema: z.object({
        found: z.boolean(),
        plan: z.record(z.string(), z.any()).optional(),
      }),
    },
    async ({ courseId, lessonId, planId }) => {
      const snap = await getFirestore()
        .doc(`courses/${courseId}/lessons/${lessonId}/plans/${planId}`)
        .get();
      if (!snap.exists) return { found: false };
      const data = snap.data() ?? {};
      const widgets = Array.isArray(data.widgets)
        ? data.widgets.map((w: Record<string, unknown>) => ({
            id: String(w.id ?? ""),
            type: String(w.type ?? ""),
            preview: String(
              w.text ?? w.title ?? w.markdown ?? w.el ?? JSON.stringify(w).slice(0, 120),
            ).slice(0, 120),
          }))
        : [];
      return {
        found: true,
        plan: {
          ...compactDoc(data),
          widgets,
        },
      };
    },
  );

const listRecentGenerationsTool = () =>
  getAI().defineTool(
    {
      name: "listRecentGenerations",
      description:
        "List recent generations (course/lesson/plan/yiayia_edit). Useful before reverting.",
      inputSchema: z.object({
        kind: z.string().optional().default(""),
        status: z.string().optional().default(""),
        limit: z.number().int().min(1).max(40).optional().default(15),
      }),
      outputSchema: z.object({
        count: z.number(),
        generations: z.array(
          z.object({
            id: z.string(),
            kind: z.string(),
            status: z.string(),
            description: z.string(),
            createdAt: z.number(),
          }),
        ),
      }),
    },
    async ({ kind, status: statusFilter, limit }) => {
      let q: FirebaseFirestore.Query = getFirestore().collection("generations");
      if (kind) q = q.where("kind", "==", kind);
      if (statusFilter) q = q.where("status", "==", statusFilter);
      const snap = await q.limit(200).get();
      const items = snap.docs
        .map((doc) => {
          const data = doc.data();
          const createdAt = data.createdAt;
          const at =
            typeof createdAt?.toMillis === "function"
              ? createdAt.toMillis()
              : Number(createdAt?._seconds ?? 0) * 1000;
          return {
            id: doc.id,
            kind: String(data.kind ?? ""),
            status: String(data.status ?? ""),
            description: String(data.trigger?.description ?? data.sourcePrompt ?? "").slice(0, 200),
            createdAt: at,
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit ?? 15);
      return { count: items.length, generations: items };
    },
  );

const previewGenerationTool = () =>
  getAI().defineTool(
    {
      name: "previewGeneration",
      description:
        "Inspect a generation: its kind, status, the docs it created/modified, models used. Call this BEFORE revertGeneration to summarize the impact for the user.",
      inputSchema: z.object({ generationId: z.string() }),
      outputSchema: z.object({
        found: z.boolean(),
        id: z.string(),
        kind: z.string(),
        status: z.string(),
        description: z.string(),
        manifestCount: z.number(),
        affectedPaths: z.array(z.string()),
        affectedCounts: z.record(z.string(), z.number()),
      }),
    },
    async ({ generationId }) => {
      const snap = await getFirestore().doc(`generations/${generationId}`).get();
      if (!snap.exists) {
        return {
          found: false,
          id: generationId,
          kind: "",
          status: "",
          description: "",
          manifestCount: 0,
          affectedPaths: [],
          affectedCounts: {},
        };
      }
      const data = snap.data() ?? {};
      const manifest: Array<{ path: string; action: string }> = Array.isArray(data.manifest)
        ? data.manifest
        : [];
      const byCollection: Record<string, number> = {};
      for (const m of manifest) {
        const parts = m.path.split("/");
        const col = parts[parts.length - 2] ?? parts[0];
        byCollection[col] = (byCollection[col] ?? 0) + 1;
      }
      return {
        found: true,
        id: generationId,
        kind: String(data.kind ?? ""),
        status: String(data.status ?? ""),
        description: String(data.trigger?.description ?? data.sourcePrompt ?? "").slice(0, 240),
        manifestCount: manifest.length,
        affectedPaths: manifest.slice(0, 8).map((m) => `${m.action} ${m.path}`),
        affectedCounts: byCollection,
      };
    },
  );

// ----------------------------------------------------------------------------
// WRITE TOOLS (factory closures over a LineageRecorder)
// ----------------------------------------------------------------------------

function createCourseTool(recorder: LineageRecorder) {
  return getAI().defineTool(
    {
      name: "createCourse",
      description:
        "Start generating a new course. Writes a stub course doc with status='initializing' — the onCourseWritten trigger picks it up and streams the result. Returns the new courseId immediately; the user can navigate to /c/{courseId} to watch it fill in.",
      inputSchema: z.object({
        sourcePrompt: z
          .string()
          .min(8)
          .max(2000)
          .describe("Plain-English description of the course."),
        idHint: z.string().optional().default(""),
      }),
      outputSchema: z.object({
        courseId: z.string(),
        path: z.string(),
        url: z.string(),
        generationId: z.string(),
      }),
    },
    async ({ sourcePrompt, idHint }) => {
      const slug = slugify((idHint ?? "") || sourcePrompt, "course");
      const suffix = Date.now().toString(36);
      const courseId = `${slug}-${suffix}`;
      const path = `courses/${courseId}`;
      const url = `/c/${courseId}`;
      const titleGuess = sourcePrompt.trim().replace(/\s+/g, " ").slice(0, 72);
      await recorder.recordSet(path, {
        id: courseId,
        title: titleGuess,
        sourcePrompt: sourcePrompt.trim(),
        language: { source: "en", target: "el" },
        status: "initializing",
        statusLog: [status("Course request created by Yiayia admin.")],
        lessonSummaries: {},
        counts: { lessons: 0, entries: 0, plans: 0, games: 0 },
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      return { courseId, path, url, generationId: recorder.id };
    },
  );
}

function createLessonTool(recorder: LineageRecorder) {
  return getAI().defineTool(
    {
      name: "createLesson",
      description:
        "Add a new lesson to an existing course. Writes a stub lesson with status='initializing' so onLessonWritten generates the title, overview, and vocabulary. Returns the new lessonId.",
      inputSchema: z.object({
        courseId: z.string(),
        sourcePrompt: z.string().min(6).max(1200),
        order: z.number().int().min(1).max(99).optional().default(99),
        targetEntryCount: z.number().int().min(8).max(60).optional().default(24),
      }),
      outputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        path: z.string(),
        url: z.string(),
        generationId: z.string(),
      }),
    },
    async ({ courseId, sourcePrompt, order, targetEntryCount }) => {
      const slug = slugify(sourcePrompt, "lesson");
      const suffix = Date.now().toString(36);
      const lessonId = `${slug}-${suffix}`;
      const path = `courses/${courseId}/lessons/${lessonId}`;
      const url = `/c/${courseId}/l/${lessonId}/overview`;
      await recorder.recordSet(path, {
        id: lessonId,
        courseId,
        title: sourcePrompt.trim().slice(0, 60),
        sourcePrompt: sourcePrompt.trim(),
        order: order ?? 99,
        targetEntryCount: targetEntryCount ?? 24,
        status: "initializing",
        statusLog: [status("Lesson request created by Yiayia admin.")],
        counts: { entries: 0, plans: 0, games: 0 },
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      return { courseId, lessonId, path, url, generationId: recorder.id };
    },
  );
}

function createPlanTool(recorder: LineageRecorder) {
  return getAI().defineTool(
    {
      name: "createPlan",
      description:
        "Add a new AI-generated plan (textbook module) to a lesson. Writes a stub plan with status='initializing' so onPlanWritten generates the widgets. Optionally take a customFocus to bias the angle (e.g. 'noun gender drill', 'taverna dialogue', 'verb conjugation').",
      inputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        customFocus: z.string().optional().default(""),
      }),
      outputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        planId: z.string(),
        planNumber: z.number(),
        path: z.string(),
        url: z.string(),
        generationId: z.string(),
      }),
    },
    async ({ courseId, lessonId, customFocus }) => {
      const focus = (customFocus ?? "").trim();
      const lessonRef = getFirestore().doc(`courses/${courseId}/lessons/${lessonId}`);
      const existing = await lessonRef.collection("plans").get();
      const planNumber = existing.size + 1;
      const planId = `${lessonId}-plan-${planNumber}`;
      const path = `courses/${courseId}/lessons/${lessonId}/plans/${planId}`;
      const url = `/c/${courseId}/l/${lessonId}/plans/${planId}`;
      await recorder.recordSet(path, {
        id: planId,
        courseId,
        lessonId,
        planNumber,
        title: focus ? `Plan ${planNumber}: ${focus.slice(0, 40)}` : `Plan ${planNumber}`,
        subtitle: "",
        coveredWords: [],
        coveredConcepts: [],
        widgets: [],
        customFocus: focus,
        status: "initializing",
        statusLog: [status("Plan request created by Yiayia admin.")],
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      return { courseId, lessonId, planId, planNumber, path, url, generationId: recorder.id };
    },
  );
}

function addEntryTool(recorder: LineageRecorder) {
  return getAI().defineTool(
    {
      name: "addEntry",
      description:
        "Add a brand-new vocabulary entry to a lesson. Use this for one-off additions (e.g. the user wants to teach 'ξυπνάω' that's missing). For bulk vocabulary, prefer triggering a generation (createLesson). Returns the new entryId; appears in the vocab tab immediately.",
      inputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        lemma: z.string().min(1).max(80).describe("The Greek headword."),
        english: z.string().min(1).max(240).describe("Short English gloss."),
        article: z.string().optional().default("").describe("Greek article (ο/η/το/τα/οι/τους/etc) when noun."),
        senses: z
          .array(z.string())
          .optional()
          .default([])
          .describe("Additional English senses besides the primary `english` field."),
        category: z
          .string()
          .optional()
          .default("")
          .describe("e.g. noun_masculine, noun_feminine, noun_neuter, verb, adjective, phrase."),
        notes: z.string().optional().default(""),
      }),
      outputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        entryId: z.string(),
        path: z.string(),
        url: z.string(),
        generationId: z.string(),
      }),
    },
    async ({ courseId, lessonId, lemma, english, article, senses, category, notes }) => {
      const lessonRef = getFirestore().doc(`courses/${courseId}/lessons/${lessonId}`);
      const lessonSnap = await lessonRef.get();
      if (!lessonSnap.exists) {
        throw new Error(`Lesson ${courseId}/${lessonId} not found.`);
      }
      const lemmaSlug = lemma
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-zA-Z0-9α-ωΑ-Ω]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 36);
      // Find the next free index by reading existing ids of form "e###".
      const entriesSnap = await lessonRef.collection("entries").get();
      let maxIndex = 0;
      let maxOrder = 0;
      for (const doc of entriesSnap.docs) {
        const m = /^e(\d{3})/.exec(doc.id);
        if (m) maxIndex = Math.max(maxIndex, Number(m[1]));
        const order = Number(doc.data().order ?? 0);
        if (Number.isFinite(order)) maxOrder = Math.max(maxOrder, order);
      }
      const nextIndex = maxIndex + 1;
      const entryId = `e${String(nextIndex).padStart(3, "0")}${lemmaSlug ? `-${lemmaSlug}` : ""}`;
      const path = `courses/${courseId}/lessons/${lessonId}/entries/${entryId}`;
      const url = `/c/${courseId}/l/${lessonId}/vocab`;

      const sensesClean = (senses ?? []).map((s) => String(s).trim()).filter(Boolean);
      const data: Record<string, unknown> = {
        id: entryId,
        courseId,
        lessonId,
        lemma: lemma.trim(),
        english: english.trim(),
        senses: sensesClean.length > 0 ? sensesClean : [english.trim()],
        order: maxOrder + 1,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      const articleClean = (article ?? "").trim();
      if (articleClean) data.article = articleClean;
      const categoryClean = (category ?? "").trim();
      if (categoryClean) data.category = categoryClean;
      const notesClean = (notes ?? "").trim();
      if (notesClean) data.notes = notesClean;

      await recorder.recordSet(path, data, "create");
      await rebuildLessonCounts(courseId, lessonId).catch(() => undefined);
      await rebuildCourseCounts(courseId).catch(() => undefined);

      return { courseId, lessonId, entryId, path, url, generationId: recorder.id };
    },
  );
}

function updateCourseTool(recorder: LineageRecorder) {
  return getAI().defineTool(
    {
      name: "updateCourse",
      description:
        "Patch a course's editable text fields. Pass only the fields you want to change. Status fields are protected — use other tools for that.",
      inputSchema: z.object({
        courseId: z.string(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        description: z.string().optional(),
        sourcePrompt: z.string().optional(),
      }),
      outputSchema: z.object({
        path: z.string(),
        updated: z.array(z.string()),
        generationId: z.string(),
      }),
    },
    async ({ courseId, title, subtitle, description, sourcePrompt }) => {
      const path = `courses/${courseId}`;
      const patch: Record<string, unknown> = { updatedAt: Timestamp.now() };
      const updated: string[] = [];
      if (title !== undefined) {
        patch.title = title;
        updated.push("title");
      }
      if (subtitle !== undefined) {
        patch.subtitle = subtitle;
        updated.push("subtitle");
      }
      if (description !== undefined) {
        patch.description = description;
        updated.push("description");
      }
      if (sourcePrompt !== undefined) {
        patch.sourcePrompt = sourcePrompt;
        updated.push("sourcePrompt");
      }
      await recorder.recordUpdate(path, patch);
      return { path, updated, generationId: recorder.id };
    },
  );
}

function updateLessonTool(recorder: LineageRecorder) {
  return getAI().defineTool(
    {
      name: "updateLesson",
      description:
        "Patch a lesson's editable text fields (title, subtitle, description, sourcePrompt, order).",
      inputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        description: z.string().optional(),
        sourcePrompt: z.string().optional(),
        order: z.number().int().optional(),
      }),
      outputSchema: z.object({
        path: z.string(),
        updated: z.array(z.string()),
        generationId: z.string(),
      }),
    },
    async ({ courseId, lessonId, title, subtitle, description, sourcePrompt, order }) => {
      const path = `courses/${courseId}/lessons/${lessonId}`;
      const patch: Record<string, unknown> = { updatedAt: Timestamp.now() };
      const updated: string[] = [];
      const summaryPatch: Record<string, unknown> = {};
      if (title !== undefined) {
        patch.title = title;
        summaryPatch[`lessonSummaries.${lessonId}.title`] = title;
        updated.push("title");
      }
      if (subtitle !== undefined) {
        patch.subtitle = subtitle;
        summaryPatch[`lessonSummaries.${lessonId}.subtitle`] = subtitle;
        updated.push("subtitle");
      }
      if (description !== undefined) {
        patch.description = description;
        updated.push("description");
      }
      if (sourcePrompt !== undefined) {
        patch.sourcePrompt = sourcePrompt;
        updated.push("sourcePrompt");
      }
      if (order !== undefined) {
        patch.order = order;
        summaryPatch[`lessonSummaries.${lessonId}.order`] = order;
        updated.push("order");
      }
      await recorder.recordUpdate(path, patch);
      if (Object.keys(summaryPatch).length > 0) {
        await getFirestore()
          .doc(`courses/${courseId}`)
          .update({ ...summaryPatch, updatedAt: Timestamp.now() })
          .catch(() => undefined);
      }
      return { path, updated, generationId: recorder.id };
    },
  );
}

function updateEntryTool(recorder: LineageRecorder) {
  return getAI().defineTool(
    {
      name: "updateEntry",
      description:
        "Patch a vocabulary entry's editable fields (lemma, article, english, senses, category, notes).",
      inputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        entryId: z.string(),
        lemma: z.string().optional(),
        article: z.string().optional(),
        english: z.string().optional(),
        senses: z.array(z.string()).optional(),
        category: z.string().optional(),
        notes: z.string().optional(),
      }),
      outputSchema: z.object({
        path: z.string(),
        updated: z.array(z.string()),
        previousValues: z.record(z.string(), z.any()),
        generationId: z.string(),
      }),
    },
    async ({ courseId, lessonId, entryId, lemma, article, english, senses, category, notes }) => {
      const path = `courses/${courseId}/lessons/${lessonId}/entries/${entryId}`;
      const ref = getFirestore().doc(path);
      const prior = (await ref.get()).data() ?? {};
      const patch: Record<string, unknown> = { updatedAt: Timestamp.now() };
      const updated: string[] = [];
      const previousValues: Record<string, unknown> = {};
      const apply = (name: string, value: unknown) => {
        if (value === undefined) return;
        previousValues[name] = prior[name] ?? null;
        patch[name] = value;
        updated.push(name);
      };
      apply("lemma", lemma);
      apply("article", article);
      apply("english", english);
      apply("senses", senses);
      apply("category", category);
      apply("notes", notes);
      await recorder.recordUpdate(path, patch);
      return { path, updated, previousValues, generationId: recorder.id };
    },
  );
}

function updatePlanTool(recorder: LineageRecorder) {
  return getAI().defineTool(
    {
      name: "updatePlan",
      description:
        "Patch a plan's text metadata (title, subtitle, estimatedMinutes, coveredWords, coveredConcepts). To replace widgets entirely, use replacePlanWidgets.",
      inputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        planId: z.string(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        estimatedMinutes: z.number().int().optional(),
        coveredWords: z.array(z.string()).optional(),
        coveredConcepts: z.array(z.string()).optional(),
      }),
      outputSchema: z.object({
        path: z.string(),
        updated: z.array(z.string()),
        generationId: z.string(),
      }),
    },
    async (input) => {
      const path = `courses/${input.courseId}/lessons/${input.lessonId}/plans/${input.planId}`;
      const patch: Record<string, unknown> = { updatedAt: Timestamp.now() };
      const updated: string[] = [];
      for (const key of [
        "title",
        "subtitle",
        "estimatedMinutes",
        "coveredWords",
        "coveredConcepts",
      ] as const) {
        const value = input[key];
        if (value !== undefined) {
          patch[key] = value;
          updated.push(key);
        }
      }
      await recorder.recordUpdate(path, patch);
      return { path, updated, generationId: recorder.id };
    },
  );
}

function updateGameTool(recorder: LineageRecorder) {
  return getAI().defineTool(
    {
      name: "updateGame",
      description: "Patch a game's editable fields (prompt, expectedAnswer, rubric, etc.).",
      inputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        gameId: z.string(),
        title: z.string().optional(),
        prompt: z.string().optional(),
        expectedAnswer: z.string().optional(),
        acceptableAnswers: z.array(z.string()).optional(),
        requiredWords: z.array(z.string()).optional(),
        passage: z.string().optional(),
        question: z.string().optional(),
        rubric: z.string().optional(),
      }),
      outputSchema: z.object({
        path: z.string(),
        updated: z.array(z.string()),
        generationId: z.string(),
      }),
    },
    async (input) => {
      const path = `courses/${input.courseId}/lessons/${input.lessonId}/games/${input.gameId}`;
      const patch: Record<string, unknown> = { updatedAt: Timestamp.now() };
      const updated: string[] = [];
      for (const key of [
        "title",
        "prompt",
        "expectedAnswer",
        "acceptableAnswers",
        "requiredWords",
        "passage",
        "question",
        "rubric",
      ] as const) {
        const value = input[key];
        if (value !== undefined) {
          patch[key] = value;
          updated.push(key);
        }
      }
      await recorder.recordUpdate(path, patch);
      return { path, updated, generationId: recorder.id };
    },
  );
}

function addLessonOverviewWidgetTool(recorder: LineageRecorder) {
  return getAI().defineTool(
    {
      name: "addLessonOverviewWidget",
      description:
        "Append a widget to the lesson's overview.widgets array. Widget shape matches the plan widget schema (heading/markdown/callout/vocab_table/etc).",
      inputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        widget: z.record(z.string(), z.any()),
      }),
      outputSchema: z.object({
        path: z.string(),
        widgetId: z.string(),
        generationId: z.string(),
      }),
    },
    async ({ courseId, lessonId, widget }) => {
      const path = `courses/${courseId}/lessons/${lessonId}`;
      const widgetId =
        typeof widget.id === "string" && widget.id
          ? widget.id
          : `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const enriched = { ...widget, id: widgetId };
      await recorder.recordArrayUnion(path, "overview.widgets", enriched).catch(async () => {
        // recordArrayUnion uses dotted paths; if that errored, fall back to a
        // read-modify-write transactionally.
        const ref = getFirestore().doc(path);
        await ref.set(
          {
            overview: {
              widgets: FieldValue.arrayUnion(enriched),
            },
            generationHistory: FieldValue.arrayUnion(recorder.id),
            updatedAt: Timestamp.now(),
          },
          { merge: true },
        );
      });
      return { path, widgetId, generationId: recorder.id };
    },
  );
}

function addPlanWidgetTool(recorder: LineageRecorder) {
  return getAI().defineTool(
    {
      name: "addPlanWidget",
      description:
        "Append a widget to a plan's widgets array. Widget shape: see plan widget schema (heading/markdown/callout/vocab_table/conjugation_table/comparison_table/reading_passage/dialogue/mini_quiz/fill_in_blanks/word_tree).",
      inputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        planId: z.string(),
        widget: z.record(z.string(), z.any()),
      }),
      outputSchema: z.object({
        path: z.string(),
        widgetId: z.string(),
        generationId: z.string(),
      }),
    },
    async ({ courseId, lessonId, planId, widget }) => {
      const path = `courses/${courseId}/lessons/${lessonId}/plans/${planId}`;
      const widgetId =
        typeof widget.id === "string" && widget.id
          ? widget.id
          : `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const enriched = { ...widget, id: widgetId };
      await recorder.recordArrayUnion(path, "widgets", enriched);
      return { path, widgetId, generationId: recorder.id };
    },
  );
}

function deleteEntryTool(recorder: LineageRecorder) {
  return getAI().defineTool(
    {
      name: "deleteEntry",
      description: "Permanently delete a vocabulary entry. Not undoable via revert.",
      inputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        entryId: z.string(),
      }),
      outputSchema: z.object({
        path: z.string(),
        counts: z.record(z.string(), z.number()),
        generationId: z.string(),
      }),
    },
    async ({ courseId, lessonId, entryId }) => {
      const path = `courses/${courseId}/lessons/${lessonId}/entries/${entryId}`;
      const removed = await deleteEntryDoc(courseId, lessonId, entryId);
      await recorder.noteDelete(path);
      await rebuildLessonCounts(courseId, lessonId);
      await rebuildCourseCounts(courseId);
      return { path, counts: counts(removed), generationId: recorder.id };
    },
  );
}

function deleteGameTool(recorder: LineageRecorder) {
  return getAI().defineTool(
    {
      name: "deleteGame",
      description: "Permanently delete a single game.",
      inputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        gameId: z.string(),
      }),
      outputSchema: z.object({
        path: z.string(),
        counts: z.record(z.string(), z.number()),
        generationId: z.string(),
      }),
    },
    async ({ courseId, lessonId, gameId }) => {
      const path = `courses/${courseId}/lessons/${lessonId}/games/${gameId}`;
      const removed = await deleteGameDoc(courseId, lessonId, gameId);
      await recorder.noteDelete(path);
      await rebuildLessonCounts(courseId, lessonId);
      await rebuildCourseCounts(courseId);
      return { path, counts: counts(removed), generationId: recorder.id };
    },
  );
}

function deletePlanTool(recorder: LineageRecorder) {
  return getAI().defineTool(
    {
      name: "deletePlan",
      description: "Permanently delete a single plan.",
      inputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        planId: z.string(),
      }),
      outputSchema: z.object({
        path: z.string(),
        counts: z.record(z.string(), z.number()),
        generationId: z.string(),
      }),
    },
    async ({ courseId, lessonId, planId }) => {
      const path = `courses/${courseId}/lessons/${lessonId}/plans/${planId}`;
      const removed = await deletePlanDoc(courseId, lessonId, planId);
      await recorder.noteDelete(path);
      await rebuildLessonCounts(courseId, lessonId);
      await rebuildCourseCounts(courseId);
      return { path, counts: counts(removed), generationId: recorder.id };
    },
  );
}

function deleteLessonTool(recorder: LineageRecorder) {
  return getAI().defineTool(
    {
      name: "deleteLesson",
      description:
        "Cascade-delete a lesson and ALL of its entries, plans, games, and batches. Confirm intent in chat before calling.",
      inputSchema: z.object({
        courseId: z.string(),
        lessonId: z.string(),
        confirm: z.literal(true),
      }),
      outputSchema: z.object({
        path: z.string(),
        counts: z.record(z.string(), z.number()),
        generationId: z.string(),
      }),
    },
    async ({ courseId, lessonId }) => {
      const path = `courses/${courseId}/lessons/${lessonId}`;
      const removed = await deleteLessonCascade(courseId, lessonId);
      await recorder.noteDelete(path);
      await removeLessonSummary(courseId, lessonId).catch(() => undefined);
      await rebuildCourseCounts(courseId).catch(() => undefined);
      return { path, counts: counts(removed), generationId: recorder.id };
    },
  );
}

function deleteCourseTool(recorder: LineageRecorder) {
  return getAI().defineTool(
    {
      name: "deleteCourse",
      description:
        "Cascade-delete a course and ALL of its lessons, entries, plans, and games. This is permanent. Confirm intent in chat before calling.",
      inputSchema: z.object({
        courseId: z.string(),
        confirm: z.literal(true),
      }),
      outputSchema: z.object({
        path: z.string(),
        counts: z.record(z.string(), z.number()),
        generationId: z.string(),
      }),
    },
    async ({ courseId }) => {
      const path = `courses/${courseId}`;
      const removed = await deleteCourseCascade(courseId);
      await recorder.noteDelete(path);
      return { path, counts: counts(removed), generationId: recorder.id };
    },
  );
}

function revertGenerationTool(_recorder: LineageRecorder) {
  return getAI().defineTool(
    {
      name: "revertGeneration",
      description:
        "Bulk-revert everything a previous generation created. ALWAYS call previewGeneration first in the same turn and report it to the user before calling this. Pass confirm:true only after explicit user agreement.",
      inputSchema: z.object({
        generationId: z.string(),
        confirm: z.literal(true),
      }),
      outputSchema: z.object({
        generationId: z.string(),
        status: z.string(),
        deletes: z.number(),
        arrayRemoves: z.number(),
        updates: z.number(),
        orphans: z.number(),
      }),
    },
    async ({ generationId }) => {
      // Inline implementation rather than re-invoking the callable: same logic,
      // but no client SDK or auth wrapper required.
      const db = getFirestore();
      const genRef = db.doc(`generations/${generationId}`);
      const claimed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(genRef);
        if (!snap.exists) throw new Error(`Generation ${generationId} not found.`);
        const data = snap.data() ?? {};
        if (data.status === "reverted") {
          return { alreadyReverted: true, manifest: [] as Array<Record<string, unknown>> };
        }
        tx.update(genRef, {
          status: "reverting",
          statusLog: FieldValue.arrayUnion(status("Revert requested via Yiayia admin chat.")),
        });
        return {
          alreadyReverted: false,
          manifest: Array.isArray(data.manifest) ? data.manifest : [],
        };
      });
      if (claimed.alreadyReverted) {
        return {
          generationId,
          status: "already-reverted",
          deletes: 0,
          arrayRemoves: 0,
          updates: 0,
          orphans: 0,
        };
      }
      const manifest = [...claimed.manifest].reverse() as Array<{
        path: string;
        action: string;
        field?: string;
        addedValue?: unknown;
      }>;
      // Paths the manifest only *updated* — these must NEVER be deleted, even
      // by the collection-group orphan cleanup below.
      const updatedPaths = new Set(
        manifest.filter((m) => m.action === "update").map((m) => m.path),
      );
      let deletes = 0;
      let arrayRemoves = 0;
      let updates = 0;
      let orphans = 0;
      for (const item of manifest) {
        try {
          const ref = db.doc(item.path);
          if (item.action === "create") {
            await ref.delete();
            deletes++;
          } else if (item.action === "arrayUnion" && item.field && item.addedValue !== undefined) {
            await ref.update({ [item.field]: FieldValue.arrayRemove(item.addedValue) });
            arrayRemoves++;
          } else if (item.action === "update") {
            await ref
              .update({
                generationHistory: FieldValue.arrayRemove(generationId),
                updatedAt: Timestamp.now(),
              })
              .catch(() => undefined);
            updates++;
          }
        } catch {
          // best-effort; orphan cleanup below catches stragglers
        }
      }
      for (const col of ["lessons", "entries", "plans", "games"]) {
        try {
          const snap = await db
            .collectionGroup(col)
            .where("generationId", "==", generationId)
            .limit(500)
            .get();
          for (const doc of snap.docs) {
            // Defensive: never delete a doc the manifest only updated.
            if (updatedPaths.has(doc.ref.path)) continue;
            await doc.ref.delete();
            orphans++;
          }
        } catch {
          // ignore
        }
      }
      // Rebuild counts for any touched lesson/course
      const courses = new Set<string>();
      const lessons = new Set<string>();
      for (const item of manifest) {
        const parts = item.path.split("/");
        if (parts[0] === "courses" && parts[1]) {
          courses.add(parts[1]);
          if (parts[2] === "lessons" && parts[3]) lessons.add(`${parts[1]}/${parts[3]}`);
        }
      }
      for (const key of lessons) {
        const [cid, lid] = key.split("/");
        await rebuildLessonCounts(cid, lid).catch(() => undefined);
      }
      for (const cid of courses) {
        await rebuildCourseCounts(cid).catch(() => undefined);
      }
      await genRef.update({
        status: "reverted",
        revertedAt: Timestamp.now(),
        revertedBy: "yiayia-admin",
        statusLog: FieldValue.arrayUnion(
          status(
            `Revert complete. Deletes=${deletes}, arrayRemoves=${arrayRemoves}, updates=${updates}, orphans=${orphans}.`,
          ),
        ),
      });
      return {
        generationId,
        status: "reverted",
        deletes,
        arrayRemoves,
        updates,
        orphans,
      };
    },
  );
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export type AdminToolSet = ToolAction[];

export function buildAdminTools(recorder: LineageRecorder): AdminToolSet {
  return [
    listCoursesTool(),
    listLessonsTool(),
    getCourseTool(),
    getLessonTool(),
    listEntriesTool(),
    listGamesTool(),
    listPlansTool(),
    getPlanTool(),
    listRecentGenerationsTool(),
    previewGenerationTool(),
    createCourseTool(recorder),
    createLessonTool(recorder),
    createPlanTool(recorder),
    addEntryTool(recorder),
    updateCourseTool(recorder),
    updateLessonTool(recorder),
    updateEntryTool(recorder),
    updatePlanTool(recorder),
    updateGameTool(recorder),
    addLessonOverviewWidgetTool(recorder),
    addPlanWidgetTool(recorder),
    deleteEntryTool(recorder),
    deleteGameTool(recorder),
    deletePlanTool(recorder),
    deleteLessonTool(recorder),
    deleteCourseTool(recorder),
    revertGenerationTool(recorder),
  ];
}
