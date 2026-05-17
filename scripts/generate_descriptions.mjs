// Generates markdown descriptions for every course + theme that doesn't have one yet.
// For each course: samples representative vocabulary across all its themes, prompts
// Gemini for a course-level intro. For each theme: samples ~50 entries and prompts
// Gemini for a lesson-level overview.
//
// Style target: the hand-written rebetiko descriptions in seed_rebetiko_descriptions.mjs
//   - H1 title, textbook-style prose
//   - At least one vocabulary table
//   - Cultural notes / pedagogical notes the AI can use as authoritative context
//
// Run:  node scripts/generate_descriptions.mjs
// Optional flags:
//   --only-courses          only write course descriptions
//   --only-themes           only write theme descriptions
//   --force                 overwrite existing descriptions
//   --course=<id>           limit to a single course id
//   --model=gemini-2.5-flash    override model
//
// Requires GOOGLE_GENAI_API_KEY (read from `firebase functions:secrets:access`).

import { Firestore } from "@google-cloud/firestore";
import { execSync } from "node:child_process";

const PROJECT_ID = "didibros-6d3ed";
const DATABASE_ID = "greek-vocab";

const args = process.argv.slice(2);
const flags = {
  onlyCourses: args.includes("--only-courses"),
  onlyThemes: args.includes("--only-themes"),
  force: args.includes("--force"),
  course: (args.find((a) => a.startsWith("--course=")) || "").split("=")[1] || null,
  model: (args.find((a) => a.startsWith("--model=")) || "").split("=")[1] || "gemini-2.5-flash",
};

function resolveApiKey() {
  if (process.env.GOOGLE_GENAI_API_KEY) return process.env.GOOGLE_GENAI_API_KEY;
  try {
    return execSync(
      `npx firebase-tools functions:secrets:access GOOGLE_GENAI_API_KEY --project ${PROJECT_ID}`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch (err) {
    throw new Error(
      "Could not resolve GOOGLE_GENAI_API_KEY. Set the env var or run `firebase functions:secrets:access GOOGLE_GENAI_API_KEY`.",
    );
  }
}

const API_KEY = resolveApiKey();
const db = new Firestore({ projectId: PROJECT_ID, databaseId: DATABASE_ID });

const MAX_DESCRIPTION_CHARS = 7800;

async function callGeminiOnce({ systemInstruction, prompt }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${flags.model}:generateContent?key=${API_KEY}`;
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
      responseMimeType: "text/plain",
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 500)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || "")
    .join("")
    .trim();
  if (!text) throw new Error(`Empty response: ${JSON.stringify(data).slice(0, 400)}`);
  return text;
}

function looksMalformed(text) {
  if (text.length > MAX_DESCRIPTION_CHARS) return "too long";
  if (/-{40,}/.test(text)) return "runaway dashes (table column blew up)";
  if (/={40,}/.test(text)) return "runaway equals";
  return null;
}

async function callGemini({ systemInstruction, prompt }) {
  let text = await callGeminiOnce({ systemInstruction, prompt });
  const issue = looksMalformed(text);
  if (issue) {
    console.log(`    retrying (reason: ${issue})…`);
    const stricter = `${systemInstruction}\n\nSTRICT: keep the output under 6000 characters total.
Tables must have short, plain notes per row (max ~80 chars per cell). Never repeat a single
character (like - or =) more than 20 times. Prefer prose paragraphs over very wide tables.`;
    text = await callGeminiOnce({ systemInstruction: stricter, prompt });
  }
  // Hard cap regardless.
  if (text.length > MAX_DESCRIPTION_CHARS) {
    text = text.slice(0, MAX_DESCRIPTION_CHARS).replace(/\s+\S*$/, "");
  }
  return text;
}

const STYLE_GUIDE = `STYLE: write rich textbook-style markdown that doubles as (a) a learner-facing
home page AND (b) authoritative source context for an AI that will later generate
plans/games/dialogues anchored in this content.

Structure (adapt sensibly to the topic):
- Start with a single H1 title matching the supplied title.
- 2-4 sentence opening hook that establishes WHY this content matters and what register
  it lives in (everyday / formal / literary / regional / classroom / etc.).
- One H2 "Why this lesson" or analogous framing section.
- At least one H2 with a vocabulary or comparison table grouping the key words by theme,
  with Greek | English | brief note (3+ rows).
- One H2 of "Key cultural/grammatical notes" or "How Greek expresses this" — concrete
  observations that capture the *flavour* of the words (register, frequency, common
  collocations, false-friend traps). Use Greek words inline in *italic*.
- Optional H2 with a short example mini-dialogue or example sentences in Greek with English
  glosses, embedded in a blockquote.
- End with an H2 "Pedagogical note" speaking directly to the future AI tutor — what kinds
  of practice scenes, examples, and tone fit this lesson. ~2-4 sentences.

Rules:
- Output ONLY the markdown body. No code fences, no preamble like "Here is...".
- Don't invent vocabulary that isn't plausibly part of the supplied sample.
- Italicise individual Greek words/phrases inline with *single asterisks*.
- Use **bold** for English emphasis sparingly.
- Length: 300-650 words. Prefer density over length.
- The voice is that of a passionate language-textbook author, not a wiki.`;

function entryToLine(e) {
  const senses = (e.english_senses || []).filter(Boolean).slice(0, 2).join(" / ");
  const cat = e.category ? ` [${e.category}]` : "";
  return `- ${e.lemma}${cat} → ${senses}`;
}

function sample(arr, n) {
  if (arr.length <= n) return arr;
  const out = [];
  const used = new Set();
  while (out.length < n) {
    const i = Math.floor(Math.random() * arr.length);
    if (used.has(i)) continue;
    used.add(i);
    out.push(arr[i]);
  }
  return out;
}

async function fetchThemeEntries(themeId, limit = 60) {
  const snap = await db
    .collection("entries")
    .where("theme_id", "==", Number(themeId))
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data());
}

function describeCoursePerCharacter(course) {
  const id = course.id;
  if (id === "3rd-grade-a1-certification") {
    return `This is a Greek primary-school reader (3rd-grade-level texts). Each lesson is
a short literary text — animal stories, daily-life vignettes, seasonal scenes — used to
introduce vocabulary in context. Hit a warm, kid-friendly textbook tone; mention that
lessons are passages, not topical word lists. Lesson titles are transliterated Greek
(e.g. "Xionanthropos" = Χιονάνθρωπος / Snowman).`;
  }
  if (id === "afrodite-lourbakos") {
    return `This is the canonical Afroditi Lourbakos vocabulary syllabus (the
well-known Modern Greek textbook by Λουρμπάκου used in adult-learner courses worldwide).
12 thematic chapters covering the full lexical map of daily life: family, home,
neighbourhood, school, work, food, clothing, leisure, time, transport, body/health,
flora/fauna. Tone: methodical, classroom-textbook, oriented toward A2-B1 learners.`;
  }
  if (id === "every-day-greek") {
    return `A modern conversational Greek course built for travellers and everyday
speakers. ~20 lessons cover greetings, family, feelings, home, food, getting around,
time/routine, shopping, body/health, weather, school, common verbs (movement,
communication), adjectives/opposites, numbers, prepositions, Greek cuisine, idioms,
celebrations. Tone: warm, conversational, A1-A2 level.`;
  }
  if (id === "top-5000") {
    return `A frequency-based course: the top 5000 most common words in Modern Greek,
split into 20 banded lessons of 250 words each (1-250, 251-500, ...). Tone: this is a
reference/drill resource, not a topical reader; explain that each band is roughly the
next slice of frequency, and that the difficulty/abstraction of the words rises with
the band number. Briefly cite where the frequency data sits in the Greek lexicon
(spoken vs written, formal vs colloquial as the rank climbs).`;
  }
  return "";
}

function describeThemePerCharacter(course, theme) {
  const courseId = course.id;
  if (courseId === "top-5000") {
    return `This is a FREQUENCY-BAND lesson (${theme.title}) — not a topical theme. The
description should briefly note the rank range, the *kind* of words that show up at
this frequency (function words at the top, increasingly specialised vocab as the rank
grows), pick out a few representative entries from the sample, and orient the learner.
Keep it shorter than a thematic lesson (250-400 words). Skip the example dialogue
section; replace with a "Representative items" bullet list of 6-10 entries.`;
  }
  if (courseId === "3rd-grade-a1-certification") {
    return `This lesson is a short reading passage from a Greek 3rd-grade reader. The
title is a transliteration of the Greek title. Treat the description as a brief teacher's
introduction to the passage: what's the story about (inferred from the vocabulary), what
themes recur, what useful vocabulary the passage delivers, and one quick "before reading"
note for the learner.`;
  }
  return "";
}

async function generateCourseDescription(course, themes) {
  const themeBlurbs = themes
    .slice(0, 14)
    .map((t) => `  • ${t.id} | ${t.title}`)
    .join("\n");

  const sampleEntries = [];
  for (const t of sample(themes, Math.min(6, themes.length))) {
    const rows = await fetchThemeEntries(t.id, 12);
    sampleEntries.push(`Lesson "${t.title}":`);
    sampleEntries.push(rows.slice(0, 8).map(entryToLine).join("\n"));
  }

  const characterNote = describeCoursePerCharacter(course);
  const prompt = `Write the markdown description for a Greek language course.

Course id: ${course.id}
Course title: ${course.title}
Total lessons: ${themes.length}

${characterNote ? `COURSE CHARACTER:\n${characterNote}\n\n` : ""}Lesson titles in this course:
${themeBlurbs}

Representative vocabulary samples across the course:
${sampleEntries.join("\n")}

Now write the course-level home-page markdown per the style rules.`;

  return callGemini({ systemInstruction: STYLE_GUIDE, prompt });
}

async function generateThemeDescription(course, theme) {
  const entries = await fetchThemeEntries(theme.id, 80);
  if (!entries.length) {
    return null;
  }
  const characterNote = describeThemePerCharacter(course, theme);
  const cats = [...new Set(entries.map((e) => e.category).filter(Boolean))];
  const sampleRows = sample(entries, Math.min(50, entries.length))
    .map(entryToLine)
    .join("\n");

  const prompt = `Write the markdown description for a single Modern Greek lesson.

Course: ${course.title} (${course.id})
Lesson id: ${theme.id}
Lesson title: ${theme.title}
Word categories present: ${cats.join(", ") || "(unknown)"}
Total entries in lesson: ${entries.length}

${characterNote ? `LESSON CHARACTER:\n${characterNote}\n\n` : ""}Representative vocabulary from this lesson (a sample — the lesson contains more):
${sampleRows}

Now write the lesson-level home-page markdown per the style rules. Anchor everything in
THIS lesson's actual vocabulary (you can quote specific words inline).`;

  return callGemini({ systemInstruction: STYLE_GUIDE, prompt });
}

async function processCourse(course, allThemes) {
  const themes = allThemes.filter((t) => t.courseId === course.id);
  console.log(`\n=== ${course.id} :: ${course.title} (${themes.length} lessons)`);

  if (!flags.onlyThemes) {
    if (course.description && !flags.force) {
      console.log("  course: already has description, skipping (use --force to overwrite)");
    } else {
      try {
        const desc = await generateCourseDescription(course, themes);
        await db.collection("courses").doc(course.id).set(
          { description: desc, updatedAt: Date.now() },
          { merge: true },
        );
        console.log(`  course: ✓ wrote ${desc.length} chars`);
      } catch (err) {
        console.error(`  course: ✗ ${err.message}`);
      }
    }
  }

  if (!flags.onlyCourses) {
    for (const theme of themes) {
      if (theme.description && !flags.force) {
        console.log(`  theme ${theme.id} (${theme.title}): already has description, skipping`);
        continue;
      }
      try {
        const desc = await generateThemeDescription(course, theme);
        if (!desc) {
          console.log(`  theme ${theme.id}: no entries, skipping`);
          continue;
        }
        await db.collection("themes").doc(String(theme.id)).set(
          { description: desc, updatedAt: Date.now() },
          { merge: true },
        );
        console.log(`  theme ${theme.id} (${theme.title}): ✓ wrote ${desc.length} chars`);
      } catch (err) {
        console.error(`  theme ${theme.id} (${theme.title}): ✗ ${err.message}`);
      }
    }
  }
}

async function main() {
  console.log(`Using model: ${flags.model}`);
  const [coursesSnap, themesSnap] = await Promise.all([
    db.collection("courses").get(),
    db.collection("themes").get(),
  ]);
  const courses = coursesSnap.docs.map((d) => d.data());
  const themes = themesSnap.docs.map((d) => d.data());

  const filteredCourses = flags.course
    ? courses.filter((c) => c.id === flags.course)
    : courses;
  if (flags.course && !filteredCourses.length) {
    console.error(`No course found with id "${flags.course}"`);
    process.exit(1);
  }

  for (const course of filteredCourses) {
    await processCourse(course, themes);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
