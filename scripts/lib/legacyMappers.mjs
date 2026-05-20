/**
 * Pure transformations from legacy document shapes to the new schema.
 * See docs/vision.md.
 *
 * Kept dependency-free so this module can be unit-tested in isolation
 * if we later add a test harness.
 */
import { createHash } from "node:crypto";

const STATUS_READY = "ready";

/** Strip Greek diacritics and lowercase. Match scripts/build_database.py:normalize_lookup. */
export function normalizeGreek(s) {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .trim();
}

/** Slug a string for use in a Firestore doc ID. */
export function slugify(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Short deterministic hash for collision-resistant entry IDs. */
export function shortHash(...parts) {
  return createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 6);
}

export function legacyLessonId(themeId) {
  return `l${themeId}`;
}

export function legacyEntryId(lemma, legacyEntryId, themeId) {
  const slug = slugify(lemma) || `e${legacyEntryId}`;
  return `${slug}-${shortHash(String(legacyEntryId), String(themeId))}`;
}

/**
 * Map a legacy `courses/{courseId}` doc to the new course shape.
 * Returns { id, data } where `data` is the document body.
 */
export function mapCourse(legacy, { generationId, now }) {
  return {
    id: legacy.id,
    data: {
      id: legacy.id,
      title: legacy.title ?? "(untitled course)",
      subtitle: legacy.subtitle ?? undefined,
      description: legacy.description ?? undefined,
      sourcePrompt: legacy.sourcePrompt ?? undefined,
      language: { source: "en", target: "el" },
      status: STATUS_READY,
      statusLog: [],
      generationId,
      lessonSummaries: {},
      counts: { lessons: 0, entries: 0, plans: 0, games: 0 },
      createdAt: legacy.createdAt ?? now,
      updatedAt: now,
    },
  };
}

/**
 * Map a legacy `themes/{themeId}` doc (the old name for a lesson)
 * to the new lesson shape.
 */
export function mapLesson(legacy, courseId, { generationId, now, fallbackOrder }) {
  return {
    id: legacyLessonId(legacy.id),
    data: {
      id: legacyLessonId(legacy.id),
      courseId,
      title: legacy.title ?? `Lesson ${legacy.id}`,
      subtitle: legacy.subtitle ?? undefined,
      description: legacy.description ?? undefined,
      sourcePrompt: legacy.sourcePrompt ?? undefined,
      order: typeof legacy.lessonOrder === "number" ? legacy.lessonOrder : fallbackOrder,
      status: STATUS_READY,
      statusLog: [],
      generationId,
      counts: { entries: 0, plans: 0, games: 0 },
      createdAt: legacy.createdAt ?? now,
      updatedAt: now,
    },
  };
}

/**
 * Map a legacy `entries/{id}` doc. The legacy entry uses `theme_id`
 * (numeric) for parent association; we map that to the new lessonId
 * via legacyLessonId().
 */
export function mapEntry(legacy, courseId, lessonId, order, { generationId, now }) {
  const senses = Array.isArray(legacy.english_senses) ? legacy.english_senses : [];
  const examples = Array.isArray(legacy.examples)
    ? legacy.examples
        .filter((e) => e && (e.el || e.en))
        .map((e) => ({ el: e.el ?? "", en: e.en ?? "" }))
    : undefined;

  return {
    id: legacyEntryId(legacy.lemma, legacy.id, legacy.theme_id),
    data: {
      id: legacyEntryId(legacy.lemma, legacy.id, legacy.theme_id),
      lessonId,
      courseId,
      lemma: legacy.lemma ?? "",
      article: legacy.article ?? undefined,
      english: legacy.english ?? senses[0] ?? "",
      senses,
      examples,
      category: legacy.category ?? undefined,
      groupKey: Array.isArray(legacy.groupKeys) ? legacy.groupKeys[0] : undefined,
      order,
      generationId,
      createdAt: legacy.createdAt ?? now,
    },
  };
}

/** Map a legacy `lesson_ai_plans/{id}` doc. */
export function mapPlan(legacy, courseId, lessonId, { generationId, now }) {
  // Existing widgets are already in our new schema's shape (the legacy app
  // and the new app share the widget discriminated-union design).
  const widgets = Array.isArray(legacy.widgets) ? legacy.widgets : [];

  return {
    id: legacy.id ?? `legacy-plan-${shortHash(String(legacy.lessonId), String(legacy.planNumber))}`,
    data: {
      id:
        legacy.id ?? `legacy-plan-${shortHash(String(legacy.lessonId), String(legacy.planNumber))}`,
      lessonId,
      courseId,
      planNumber: typeof legacy.planNumber === "number" ? legacy.planNumber : 1,
      title: legacy.title ?? "(untitled plan)",
      subtitle: legacy.subtitle ?? undefined,
      estimatedMinutes: legacy.estimatedMinutes ?? undefined,
      coveredWords: Array.isArray(legacy.coveredWords) ? legacy.coveredWords : [],
      coveredConcepts: Array.isArray(legacy.coveredConcepts) ? legacy.coveredConcepts : [],
      status: STATUS_READY,
      statusLog: [],
      widgets,
      generationId,
      createdAt: legacy.createdAt ?? now,
      updatedAt: legacy.updatedAt ?? now,
    },
  };
}

/** Map a legacy `lesson_ai_exercises/{id}` doc (we call these "games" now). */
export function mapGame(legacy, courseId, lessonId, { generationId, now }) {
  return {
    id: legacy.id ?? `legacy-game-${shortHash(String(legacy.lessonId), String(legacy.type))}`,
    data: {
      id: legacy.id ?? `legacy-game-${shortHash(String(legacy.lessonId), String(legacy.type))}`,
      lessonId,
      courseId,
      type: legacy.type ?? "word_translation",
      title: legacy.title ?? undefined,
      prompt: legacy.prompt ?? "",
      expectedAnswer: legacy.expectedAnswer ?? undefined,
      acceptableAnswers: Array.isArray(legacy.acceptableAnswers)
        ? legacy.acceptableAnswers
        : undefined,
      requiredWords: Array.isArray(legacy.requiredWords) ? legacy.requiredWords : undefined,
      vocabulary: Array.isArray(legacy.vocabulary) ? legacy.vocabulary : undefined,
      sourceEntryIds: Array.isArray(legacy.sourceEntryIds) ? legacy.sourceEntryIds : [],
      direction: legacy.direction ?? undefined,
      passage: legacy.passage ?? undefined,
      question: legacy.question ?? undefined,
      rubric: legacy.rubric ?? undefined,
      generationId,
      createdAt: legacy.createdAt ?? now,
    },
  };
}
