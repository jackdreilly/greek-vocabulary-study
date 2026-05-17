import { httpsCallable } from "firebase/functions";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db, functions } from "./firebase";

export const gameTypes = [
  { id: "missing_word", label: "Missing word", short: "Blank" },
  { id: "reading_comprehension", label: "Passage questions", short: "Read" },
  { id: "story_prompt", label: "Short story", short: "Story" },
  { id: "sentence_translation", label: "Sentence translation", short: "Sentence" },
  { id: "word_translation", label: "Word translation", short: "Word" },
];

export const gameTypeLabels = Object.fromEntries(gameTypes.map((type) => [type.id, type.label]));

export function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeStudyText(text) {
  return String(text || "")
    .toLocaleLowerCase("el")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function deterministicMatch(answer, expectedAnswers) {
  const normalized = normalizeStudyText(answer);
  if (!normalized) return false;
  return expectedAnswers.some((candidate) => normalizeStudyText(candidate) === normalized);
}

export function sourceDigest(exercise) {
  return [
    exercise.type,
    exercise.direction,
    exercise.coverage?.summary,
    ...(exercise.coverage?.words || []),
    ...(exercise.coverage?.themes || []),
    compactText(exercise.prompt),
    compactText(exercise.question),
    compactText(exercise.expectedAnswer),
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 500);
}

export function entriesForAI(entries) {
  return entries
    .filter((entry) => entry?.lemma && (entry.english || entry.english_senses?.length))
    .map((entry) => ({
      id: entry.id,
      lemma: entry.lemma,
      article: entry.article || null,
      english: entry.english || "",
      english_senses: entry.english_senses || [],
      category: entry.category || "",
    }));
}

export function shuffleIds(items) {
  const ids = items.map((item) => item.id);
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [ids[index], ids[swapIndex]] = [ids[swapIndex], ids[index]];
  }
  return ids;
}

function withDefaults(exercise, lessonId, generatedBy = "seed") {
  const id = exercise.id || `l${lessonId}-${exercise.type}-${Math.random().toString(36).slice(2, 9)}`;
  const requiredWords = exercise.requiredWords || [];
  return {
    acceptableAnswers: [],
    requiredWords,
    vocabulary: [],
    sourceEntryIds: [],
    coverage: {
      summary: compactText(exercise.title || exercise.prompt || exercise.type).slice(0, 120),
      words: requiredWords.slice(0, 12),
      themes: [exercise.type].filter(Boolean),
      ...(exercise.coverage || {}),
    },
    status: "active",
    lessonId,
    generatedBy,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...exercise,
    id,
  };
}

export async function loadLessonExercises(lessonId) {
  const q = query(collection(db, "lesson_ai_exercises"), where("lessonId", "==", Number(lessonId)));
  const snapshot = await Promise.race([
    getDocs(q),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Saved games are still loading. Try again in a moment.")), 15000)),
  ]);
  return snapshot.docs
    .map((item) => item.data())
    .filter((item) => item.status !== "removed")
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

export async function saveLessonExercise(exercise) {
  const payload = { ...exercise, updatedAt: Date.now() };
  await setDoc(doc(db, "lesson_ai_exercises", String(payload.id)), payload, { merge: true });
  return payload;
}

export async function removeLessonExercise(exercise) {
  if (exercise.generatedBy === "seed" && !exercise.createdInFirestore) {
    return;
  }
  await updateDoc(doc(db, "lesson_ai_exercises", String(exercise.id)), {
    status: "removed",
    updatedAt: Date.now(),
  });
}

export async function hardDeleteLessonExercise(exercise) {
  await deleteDoc(doc(db, "lesson_ai_exercises", String(exercise.id)));
}

export function wordTranslationExercises(lessonId, entries) {
  const eligible = entries.filter((e) => e.english_senses?.length || e.english);
  return eligible.flatMap((entry) => {
    const greek = entry.term || entry.lemma;
    const english = (entry.english_senses?.[0] || entry.english || "").trim();
    if (!greek || !english) return [];
    const base = {
      lessonId,
      type: "word_translation",
      title: greek,
      passage: "",
      question: "",
      requiredWords: [],
      vocabulary: [],
      sourceEntryIds: [entry.id],
      coverage: { summary: greek, words: [greek], themes: ["word_translation"] },
      rubric: "",
      status: "active",
      generatedBy: "vocab",
      createdAt: 0,
      updatedAt: 0,
      acceptableAnswers: entry.english_senses?.slice(1) ?? [],
    };
    return [
      { ...base, id: `l${lessonId}-wt-gr-${entry.id}`, direction: "greek_to_english", prompt: greek, instructions: "Translate to English", expectedAnswer: english },
      { ...base, id: `l${lessonId}-wt-en-${entry.id}`, direction: "english_to_greek", prompt: english, instructions: "Translate to Greek", expectedAnswer: greek },
    ];
  });
}

export async function generateLessonExercises({ lesson, entries, countPerType = 5, previousExercises = [], preferences }) {
  const callable = httpsCallable(functions, "generateLessonGames");
  const result = await callable({
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    courseTitle: lesson.course || lesson.courseRecord?.title || '',
    courseDescription: (lesson.courseRecord?.description || '').slice(0, 5000),
    courseSourcePrompt: (lesson.courseRecord?.sourcePrompt || '').slice(0, 1200),
    lessonDescription: (lesson.description || '').slice(0, 8000),
    lessonSourcePrompt: (lesson.sourcePrompt || '').slice(0, 1200),
    countPerType,
    previousExerciseDigests: previousExercises.map(sourceDigest),
    entries: entriesForAI(entries).slice(0, 100),
    preferences,
  });
  return (result.data?.exercises || []).map((exercise) => withDefaults(exercise, lesson.id, "ai"));
}

export async function scoreExerciseAnswer({ lesson, exercise, answer, preferences }) {
  const expected = [exercise.expectedAnswer, ...(exercise.acceptableAnswers || [])].filter(Boolean);
  if (deterministicMatch(answer, expected)) {
    const greek = preferences?.responseLanguage === "greek";
    return {
      accepted: true,
      score: 0.98,
      verdict: "correct",
      feedback: greek
        ? "Ταιριάζει με τον στόχο. Πες το άλλη μία φορά δυνατά και συνέχισε."
        : "That matches the target. Say it once more out loud and keep going.",
      betterAnswer: exercise.expectedAnswer,
      shortReason: greek ? "Ακριβής απάντηση" : "Exact match",
      greekCorrection: null,
    };
  }

  const callable = httpsCallable(functions, "scoreGameAnswer");
  const result = await callable({
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    exercise,
    answer,
    preferences,
  });
  return result.data;
}

function yiayiaRequestContext({ lesson, course }) {
  const activeLesson = lesson || {};
  const activeCourse = course || activeLesson.courseRecord || {};
  const courseTitle = activeLesson.course || activeCourse.title || activeCourse.name || "";
  return {
    lessonId: Number(activeLesson.id || 0),
    lessonTitle: activeLesson.title || courseTitle || "GreekFlash",
    courseId: activeCourse.id || activeLesson.courseId || "",
    courseTitle,
    courseDescription: (activeCourse.description || "").slice(0, 5000),
    courseSourcePrompt: (activeCourse.sourcePrompt || "").slice(0, 1200),
    courseLessons: (activeCourse.lessons || []).slice(0, 80).map((item) => ({
      id: item.id,
      title: item.title || "",
      entryCount: Number(item.entry_count || item.entryCount || 0),
    })),
    lessonDescription: (activeLesson.description || "").slice(0, 8000),
    lessonSourcePrompt: (activeLesson.sourcePrompt || "").slice(0, 1200),
  };
}

export async function sendYiayiaMessage({ lesson, course, exercise, entries, messages, preferences, adminMode = false }) {
  const callable = httpsCallable(functions, "yiayiaChat");
  const result = await callable({
    ...yiayiaRequestContext({ lesson, course }),
    exercise,
    entries: entriesForAI(entries).slice(0, 80),
    messages: messages.map((message) => ({
      role: message.role,
      content: message.requestContent || message.content,
    })),
    preferences,
    adminMode,
  });
  return String(result.data || "");
}

export async function streamYiayiaMessage({ lesson, course, exercise, entries, messages, preferences, adminMode = false, onChunk }) {
  const callable = httpsCallable(functions, "yiayiaChat");
  if (typeof callable.stream !== "function") {
    return sendYiayiaMessage({ lesson, course, exercise, entries, messages, preferences, adminMode });
  }
  const result = await callable.stream({
    ...yiayiaRequestContext({ lesson, course }),
    exercise,
    entries: entriesForAI(entries).slice(0, 80),
    messages: messages.map((message) => ({
      role: message.role,
      content: message.requestContent || message.content,
    })),
    preferences,
    aiModel: preferences?.aiModel || 'lite',
    adminMode,
  });
  let accumulated = "";
  for await (const chunk of result.stream) {
    const text = String(chunk || "");
    accumulated += text;
    onChunk?.(accumulated);
  }
  const final = await result.data;
  return accumulated || String(final || "");
}

export function seedLessonFourExercises() {
  const items = [
    {
      id: "l4-missing-01",
      type: "missing_word",
      title: "The school room",
      prompt: "Η δασκάλα γράφει στον _____ με κιμωλία.",
      instructions: "Fill in the missing Greek word.",
      expectedAnswer: "πίνακα",
      acceptableAnswers: ["πίνακας"],
      direction: "english_to_greek",
      requiredWords: ["πίνακας"],
      vocabulary: [{ greek: "πίνακας", english: "board / chart" }],
      sourceEntryIds: [835],
      rubric: "The learner supplies πίνακας in a natural inflected form.",
    },
    {
      id: "l4-missing-02",
      type: "missing_word",
      title: "Reading time",
      prompt: "Ο μαθητής _____ ένα βιβλίο στη βιβλιοθήκη.",
      instructions: "Fill in the missing Greek verb.",
      expectedAnswer: "διαβάζει",
      acceptableAnswers: ["διαβάζω"],
      direction: "english_to_greek",
      requiredWords: ["διαβάζω"],
      vocabulary: [{ greek: "διαβάζω", english: "read" }],
      sourceEntryIds: [916, 738, 739, 815],
      rubric: "The learner uses the verb διαβάζω, preferably as διαβάζει.",
    },
    {
      id: "l4-missing-03",
      type: "missing_word",
      title: "Notebook",
      prompt: "Η μαθήτρια ανοίγει το _____ και γράφει την άσκηση.",
      instructions: "Fill in the missing Greek noun.",
      expectedAnswer: "τετράδιο",
      acceptableAnswers: ["τετράδιό"],
      direction: "english_to_greek",
      requiredWords: ["τετράδιο"],
      vocabulary: [{ greek: "τετράδιο", english: "notebook" }],
      sourceEntryIds: [862, 816, 733],
      rubric: "The learner supplies τετράδιο.",
    },
    {
      id: "l4-missing-04",
      type: "missing_word",
      title: "Pencil",
      prompt: "Χρειάζομαι ένα _____ για το διαγώνισμα.",
      instructions: "Fill in the missing Greek word.",
      expectedAnswer: "μολύβι",
      acceptableAnswers: [],
      direction: "english_to_greek",
      requiredWords: ["μολύβι"],
      vocabulary: [{ greek: "μολύβι", english: "pencil" }],
      sourceEntryIds: [819, 759],
      rubric: "The learner supplies μολύβι.",
    },
    {
      id: "l4-missing-05",
      type: "missing_word",
      title: "Learning",
      prompt: "Στο σχολείο _____ καινούριες λέξεις κάθε μέρα.",
      instructions: "Fill in the missing Greek verb.",
      expectedAnswer: "μαθαίνουμε",
      acceptableAnswers: ["μαθαίνω"],
      direction: "english_to_greek",
      requiredWords: ["μαθαίνω"],
      vocabulary: [{ greek: "μαθαίνω", english: "learn" }],
      sourceEntryIds: [857, 929],
      rubric: "The learner uses μαθαίνω in a suitable form.",
    },
    {
      id: "l4-read-01",
      type: "reading_comprehension",
      title: "Morning class",
      passage: "Το πρωί η τάξη είναι ήσυχη. Ο δάσκαλος γράφει μια λέξη στον πίνακα. Οι μαθητές ανοίγουν τα τετράδιά τους.",
      prompt: "Read the passage and answer the question.",
      question: "Πού γράφει ο δάσκαλος τη λέξη;",
      instructions: "Answer in Greek or English.",
      expectedAnswer: "Στον πίνακα.",
      acceptableAnswers: ["on the board", "στον πίνακα", "πίνακα"],
      direction: "free_response",
      requiredWords: ["πίνακας", "δάσκαλος", "τάξη"],
      sourceEntryIds: [860, 753, 835, 815, 862],
      rubric: "The answer identifies that the teacher writes on the board.",
    },
    {
      id: "l4-read-02",
      type: "reading_comprehension",
      title: "At the library",
      passage: "Στη βιβλιοθήκη η Μαρία διαβάζει ένα βιβλίο για την ιστορία. Μετά γράφει μια μικρή περίληψη στο τετράδιό της.",
      prompt: "Read the passage and answer the question.",
      question: "Τι διαβάζει η Μαρία;",
      instructions: "Answer in Greek or English.",
      expectedAnswer: "Ένα βιβλίο για την ιστορία.",
      acceptableAnswers: ["a book about history", "βιβλίο για την ιστορία"],
      direction: "free_response",
      requiredWords: ["βιβλιοθήκη", "διαβάζω", "βιβλίο", "τετράδιο"],
      sourceEntryIds: [739, 916, 738, 862],
      rubric: "The answer says Maria reads a book about history.",
    },
    {
      id: "l4-read-03",
      type: "reading_comprehension",
      title: "The test",
      passage: "Σήμερα έχουμε διαγώνισμα. Ο μαθητής έχει μολύβι, ξύστρα και καθαρό γραπτό. Θέλει έναν καλό βαθμό.",
      prompt: "Read the passage and answer the question.",
      question: "Τι θέλει ο μαθητής;",
      instructions: "Answer in Greek or English.",
      expectedAnswer: "Θέλει έναν καλό βαθμό.",
      acceptableAnswers: ["a good grade", "καλό βαθμό", "έναν καλό βαθμό"],
      direction: "free_response",
      requiredWords: ["διαγώνισμα", "μαθητής", "μολύβι", "βαθμός"],
      sourceEntryIds: [759, 815, 819, 737],
      rubric: "The answer identifies that the student wants a good grade.",
    },
    {
      id: "l4-read-04",
      type: "reading_comprehension",
      title: "A studious student",
      passage: "Η Ελένη είναι μελετηρή. Κάθε απόγευμα κάνει την άσκηση, διαβάζει το μάθημα και μαθαίνει νέες λέξεις.",
      prompt: "Read the passage and answer the question.",
      question: "Πότε διαβάζει η Ελένη;",
      instructions: "Answer in Greek or English.",
      expectedAnswer: "Κάθε απόγευμα.",
      acceptableAnswers: ["every afternoon", "το απόγευμα"],
      direction: "free_response",
      requiredWords: ["μελετηρός", "άσκηση", "μάθημα", "μαθαίνω"],
      sourceEntryIds: [900, 733, 811, 929],
      rubric: "The answer says she studies every afternoon.",
    },
    {
      id: "l4-read-05",
      type: "reading_comprehension",
      title: "Announcement",
      passage: "Η ανακοίνωση λέει ότι το μάθημα αρχίζει στις εννέα. Οι μαθητές πρέπει να είναι στην αίθουσα νωρίς.",
      prompt: "Read the passage and answer the question.",
      question: "Πού πρέπει να είναι οι μαθητές;",
      instructions: "Answer in Greek or English.",
      expectedAnswer: "Στην αίθουσα.",
      acceptableAnswers: ["in the classroom", "in the room", "στην αίθουσα"],
      direction: "free_response",
      requiredWords: ["ανακοίνωση", "μάθημα", "μαθητής", "αίθουσα"],
      sourceEntryIds: [724, 811, 815, 721],
      rubric: "The answer says students must be in the room/classroom.",
    },
    {
      id: "l4-story-01",
      type: "story_prompt",
      title: "First day",
      prompt: "Write 3-5 Greek sentences about a first day at school.",
      instructions: "Use all of these words: σχολείο, τάξη, δάσκαλος, μαθητής, βιβλίο.",
      expectedAnswer: "A short understandable Greek story using σχολείο, τάξη, δάσκαλος, μαθητής, βιβλίο.",
      acceptableAnswers: [],
      direction: "free_response",
      requiredWords: ["σχολείο", "τάξη", "δάσκαλος", "μαθητής", "βιβλίο"],
      sourceEntryIds: [857, 860, 753, 815, 738],
      rubric: "Uses all required words in a coherent school story; minor grammar errors are acceptable.",
    },
    {
      id: "l4-story-02",
      type: "story_prompt",
      title: "Library afternoon",
      prompt: "Write 3-5 Greek sentences about studying in a library.",
      instructions: "Use all of these words: βιβλιοθήκη, διαβάζω, τετράδιο, γράφω, μάθημα.",
      expectedAnswer: "A short understandable Greek story using βιβλιοθήκη, διαβάζω, τετράδιο, γράφω, μάθημα.",
      acceptableAnswers: [],
      direction: "free_response",
      requiredWords: ["βιβλιοθήκη", "διαβάζω", "τετράδιο", "γράφω", "μάθημα"],
      sourceEntryIds: [739, 916, 862, 915, 811],
      rubric: "Uses all required words and keeps the story tied to studying.",
    },
    {
      id: "l4-story-03",
      type: "story_prompt",
      title: "A test day",
      prompt: "Write 3-5 Greek sentences about a test day.",
      instructions: "Use all of these words: διαγώνισμα, μολύβι, γραπτό, βαθμός, μαθαίνω.",
      expectedAnswer: "A short understandable Greek story using διαγώνισμα, μολύβι, γραπτό, βαθμός, μαθαίνω.",
      acceptableAnswers: [],
      direction: "free_response",
      requiredWords: ["διαγώνισμα", "μολύβι", "γραπτό", "βαθμός", "μαθαίνω"],
      sourceEntryIds: [759, 819, 743, 737, 929],
      rubric: "Uses all required words in context and shows the test-day idea clearly.",
    },
    {
      id: "l4-story-04",
      type: "story_prompt",
      title: "Teacher and board",
      prompt: "Write 3-5 Greek sentences about a teacher explaining something.",
      instructions: "Use all of these words: δασκάλα, πίνακας, κιμωλία, άσκηση, ορθογραφία.",
      expectedAnswer: "A short understandable Greek story using δασκάλα, πίνακας, κιμωλία, άσκηση, ορθογραφία.",
      acceptableAnswers: [],
      direction: "free_response",
      requiredWords: ["δασκάλα", "πίνακας", "κιμωλία", "άσκηση", "ορθογραφία"],
      sourceEntryIds: [752, 835, 800, 733, 829],
      rubric: "Uses all required words and forms a coherent classroom moment.",
    },
    {
      id: "l4-story-05",
      type: "story_prompt",
      title: "Good habits",
      prompt: "Write 3-5 Greek sentences about a studious learner.",
      instructions: "Use all of these words: μελετηρός, ανάγνωση, εκπαίδευση, βοήθημα, μαθήτρια.",
      expectedAnswer: "A short understandable Greek story using μελετηρός, ανάγνωση, εκπαίδευση, βοήθημα, μαθήτρια.",
      acceptableAnswers: [],
      direction: "free_response",
      requiredWords: ["μελετηρός", "ανάγνωση", "εκπαίδευση", "βοήθημα", "μαθήτρια"],
      sourceEntryIds: [900, 722, 769, 740, 816],
      rubric: "Uses all required words and communicates the learner's habits.",
    },
    {
      id: "l4-sentence-01",
      type: "sentence_translation",
      title: "Translate to English",
      prompt: "Ο μαθητής γράφει στο τετράδιο.",
      instructions: "Translate the sentence into English.",
      expectedAnswer: "The student writes in the notebook.",
      acceptableAnswers: ["The pupil writes in the notebook.", "The student is writing in the notebook."],
      direction: "greek_to_english",
      sourceEntryIds: [815, 915, 862],
      rubric: "The translation preserves student, writing, and notebook.",
    },
    {
      id: "l4-sentence-02",
      type: "sentence_translation",
      title: "Translate to Greek",
      prompt: "The teacher opens the book.",
      instructions: "Translate the sentence into Greek.",
      expectedAnswer: "Ο δάσκαλος ανοίγει το βιβλίο.",
      acceptableAnswers: ["Η δασκάλα ανοίγει το βιβλίο."],
      direction: "english_to_greek",
      sourceEntryIds: [753, 752, 738],
      rubric: "The translation includes teacher, opens, and book in natural Greek.",
    },
    {
      id: "l4-sentence-03",
      type: "sentence_translation",
      title: "Translate to English",
      prompt: "Η τάξη μαθαίνει καινούριες λέξεις.",
      instructions: "Translate the sentence into English.",
      expectedAnswer: "The class learns new words.",
      acceptableAnswers: ["The class is learning new words."],
      direction: "greek_to_english",
      sourceEntryIds: [860, 929],
      rubric: "The translation preserves class, learning, and new words.",
    },
    {
      id: "l4-sentence-04",
      type: "sentence_translation",
      title: "Translate to Greek",
      prompt: "Maria reads in the library.",
      instructions: "Translate the sentence into Greek.",
      expectedAnswer: "Η Μαρία διαβάζει στη βιβλιοθήκη.",
      acceptableAnswers: ["Η Μαρία διαβάζει στην βιβλιοθήκη."],
      direction: "english_to_greek",
      sourceEntryIds: [916, 739],
      rubric: "The translation includes Maria, reads, and library in natural Greek.",
    },
    {
      id: "l4-sentence-05",
      type: "sentence_translation",
      title: "Translate to English",
      prompt: "Χρειάζομαι μολύβι για το διαγώνισμα.",
      instructions: "Translate the sentence into English.",
      expectedAnswer: "I need a pencil for the test.",
      acceptableAnswers: ["I need a pencil for the exam."],
      direction: "greek_to_english",
      sourceEntryIds: [819, 759],
      rubric: "The translation preserves need, pencil, and test/exam.",
    },
    {
      id: "l4-word-01",
      type: "word_translation",
      title: "Word translation",
      prompt: "σχολείο",
      instructions: "Translate this Greek word into English.",
      expectedAnswer: "school",
      acceptableAnswers: [],
      direction: "greek_to_english",
      sourceEntryIds: [857],
      rubric: "The answer means school.",
    },
    {
      id: "l4-word-02",
      type: "word_translation",
      title: "Word translation",
      prompt: "notebook",
      instructions: "Translate this English word into Greek.",
      expectedAnswer: "τετράδιο",
      acceptableAnswers: [],
      direction: "english_to_greek",
      sourceEntryIds: [862],
      rubric: "The answer is τετράδιο.",
    },
    {
      id: "l4-word-03",
      type: "word_translation",
      title: "Word translation",
      prompt: "βιβλιοθήκη",
      instructions: "Translate this Greek word into English.",
      expectedAnswer: "library",
      acceptableAnswers: ["bookcase"],
      direction: "greek_to_english",
      sourceEntryIds: [739],
      rubric: "The answer means library; bookcase is acceptable.",
    },
    {
      id: "l4-word-04",
      type: "word_translation",
      title: "Word translation",
      prompt: "pencil",
      instructions: "Translate this English word into Greek.",
      expectedAnswer: "μολύβι",
      acceptableAnswers: [],
      direction: "english_to_greek",
      sourceEntryIds: [819],
      rubric: "The answer is μολύβι.",
    },
    {
      id: "l4-word-05",
      type: "word_translation",
      title: "Word translation",
      prompt: "μαθαίνω",
      instructions: "Translate this Greek word into English.",
      expectedAnswer: "learn",
      acceptableAnswers: ["to learn", "acquire knowledge"],
      direction: "greek_to_english",
      sourceEntryIds: [929],
      rubric: "The answer means learn.",
    },
  ];

  return items.map((item) => withDefaults(item, 4, "seed"));
}
