<script>
  import { onMount } from "svelte";
  import {
    Home,
    Layers3,
    Sparkles,
    BookOpen,
    GraduationCap,
    Menu,
    X,
    Keyboard,
    Edit2,
    Plus,
    Trash2,
    ImageIcon,
    Upload,
    LoaderCircle
  } from "lucide-svelte";
  import { db, storage } from "./lib/firebase";
  import { textMatchesSearch } from "./lib/search.js";
  import { generateVocabSuggestions, aiAssistVocabEntry, saveNewVocabEntry, generateLessonContent, saveNewLesson } from "./lib/aiVocab.js";
  import { collection, getDocs, query, where, orderBy, doc, updateDoc } from "firebase/firestore";
  import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
  
  // Components
  import CourseList from "./CourseList.svelte";
  import LessonList from "./LessonList.svelte";
  import FlashcardsPage from "./FlashcardsPage.svelte";
  import AIPractice from "./AIPractice.svelte";
  import VocabPage from "./VocabPage.svelte";
  import PlansPage from "./PlansPage.svelte";
  import YiaYiaChat from "./YiaYiaChat.svelte";

  // Data State
  // Themes are the top of the cascade — small (~40 docs), loaded once on boot.
  // Entries are loaded on demand per lesson and cached in lessonEntriesCache.
  let themes = null;
  let loadError = "";
  let lessonEntriesCache = new Map();   // lessonId (Number) -> Entry[]
  let lessonEntriesLoading = new Set(); // lessonIds currently being fetched
  let lessonEntriesError = "";
  let view = "courses"; // "courses" | "lessons" | "study"
  let activeTab = "cards"; // "cards" | "games" | "vocab" | "plans"

  // Selection State
  let selectedCourse = null;
  let selectedLessonId = null;
  let selectedType = "all";
  let selectedGroup = "all";
  let translatedOnly = true;
  let cardIndex = 0;
  let cardFlipped = false;
  let cardMode = "gr-en";
  let imageMode = "back";
  
  // UI State
  let lessonSidebarOpen = typeof window !== 'undefined' ? window.innerWidth >= 768 : true;
  let shortcutsOpen = false;
  let editingEntry = null;
  let currentExercise = null; // For YiaYia context
  let audioLoadingId = null;
  let currentAudio = null;

  // AI Vocab state
  let addVocabOpen = false;
  let addVocabPrompt = '';
  let addVocabGenerating = false;
  let addVocabSuggestions = [];
  let addVocabSelected = new Set();
  let addVocabSaving = false;
  let addVocabError = '';

  // AI Edit Assist state (within the edit modal)
  let aiEditPrompt = '';
  let aiEditGenerating = false;
  let aiEditError = '';

  // Image picker state (within the edit modal)
  let imagePickerOpen = false;
  let imagePickerQuery = '';
  let imagePickerResults = [];
  let imagePickerLoading = false;
  let imagePickerError = '';

  async function searchPexelsImages() {
    if (!imagePickerQuery.trim()) return;
    imagePickerLoading = true;
    imagePickerError = '';
    imagePickerResults = [];
    try {
      const key = import.meta.env.VITE_PEXELS_API_KEY;
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(imagePickerQuery.trim())}&per_page=6&orientation=landscape`;
      const res = await fetch(url, { headers: { Authorization: key } });
      if (!res.ok) throw new Error(`Pexels error ${res.status}`);
      const data = await res.json();
      imagePickerResults = data.photos ?? [];
    } catch (e) {
      imagePickerError = e.message || 'Search failed';
    } finally {
      imagePickerLoading = false;
    }
  }

  function openImagePicker() {
    const senses = editingEntry?.english_senses ?? [];
    imagePickerQuery = senses.length ? senses[0].replace(/\(.*?\)/g, '').split(/[;,]/)[0].trim() : editingEntry?.lemma ?? '';
    imagePickerResults = [];
    imagePickerError = '';
    imagePickerOpen = true;
    searchPexelsImages();
  }

  function pickPexelsImage(photo) {
    editingEntry = {
      ...editingEntry,
      image: {
        url: photo.src.large,
        thumbnail: photo.src.medium,
        position: 'center',
      }
    };
    imagePickerOpen = false;
    imagePickerResults = [];
  }

  function removeImage() {
    editingEntry = { ...editingEntry, image: null };
    imagePickerOpen = false;
  }

  // AI Generate Lesson state
  let genLessonOpen = false;
  let genLessonPrompt = '';
  let genLessonGenerating = false;
  let genLessonResult = null; // { lessonTitle, entries[], selectedEntries: Set }
  let genLessonTitle = '';
  let genLessonSelected = new Set();
  let genLessonSaving = false;
  let genLessonError = '';

  // AI Generate Course state
  let genCourseOpen = false;
  let genCoursePrompt = '';
  let genCourseGenerating = false;
  let genCourseResult = null; // { courseName, lessonTitle, entries[] }
  let genCourseName = '';
  let genCourseLessonTitle = '';
  let genCourseSelected = new Set();
  let genCourseSaving = false;
  let genCourseError = '';

  // Search/Filters (Shared)
  let globalSearch = "";

  const TOP_5000_ID = 13;
  const TOP_5000_SUB_BASE = 1300; // virtual IDs 1301-1320
  const TOP_5000_CHUNK = 250;

  // Course definitions: maps theme id ranges to course names
  const COURSE_DEFS = [
    { name: "Afrodite Lourbakos", ids: (id) => id >= 1 && id <= 12 },
    { name: "Top 5000", ids: (id) => id > TOP_5000_SUB_BASE && id <= TOP_5000_SUB_BASE + 20 },
    { name: "3rd Grade A1 Certification", ids: (id) => id >= 14 && id <= 19 },
    { name: "Every Day Greek", ids: (id) => id >= 20 && id <= 39 },
  ];

  // Formatting helpers
const displayType = (v) => ({"Ουσιαστικά": "Nouns", "Επίθετα": "Adjectives", "Ρήματα": "Verbs", "Εκφράσεις": "Phrases", "Top 5000": "Top 5000"})[v] ?? v;
  const displayGroup = (k) => ({art:"Articles", part:"Particles", v:"Verbs", n:"Nouns", adj:"Adjectives", adv:"Adverbs", prep:"Prepositions", pron:"Pronouns", conj:"Conjunctions", interj:"Interjections", det:"Determiners", num:"Numbers", coll:"Collective"})[k] ?? k;

  async function loadThemes() {
    try {
      const snap = await getDocs(collection(db, "themes"));
      themes = prepareThemes(snap.docs.map(d => d.data()));
      loadStateFromUrl();
    } catch (e) {
      loadError = e.message;
    }
  }

  async function loadLessonEntries(lessonId) {
    const id = Number(lessonId);
    if (!id || !themes) return;
    if (lessonEntriesCache.has(id) || lessonEntriesLoading.has(id)) return;

    lessonEntriesLoading.add(id);
    lessonEntriesLoading = new Set(lessonEntriesLoading);
    lessonEntriesError = "";

    try {
      const theme = themes.find(t => Number(t.id) === id);
      let q;
      if (theme?.rankStart != null && theme?.rankEnd != null) {
        // Top 5000 sub-lesson: range query on frequency_rank within theme 13.
        // Requires composite index (theme_id ASC, frequency_rank ASC).
        q = query(
          collection(db, "entries"),
          where("theme_id", "==", TOP_5000_ID),
          where("frequency_rank", ">=", theme.rankStart),
          where("frequency_rank", "<=", theme.rankEnd),
          orderBy("frequency_rank"),
        );
      } else {
        q = query(collection(db, "entries"), where("theme_id", "==", id));
      }
      const snap = await getDocs(q);
      const rows = snap.docs.map(d => prepareEntry(d.data()));
      lessonEntriesCache.set(id, rows);
      lessonEntriesCache = new Map(lessonEntriesCache);
    } catch (e) {
      lessonEntriesError = e.message || "Could not load lesson.";
    } finally {
      lessonEntriesLoading.delete(id);
      lessonEntriesLoading = new Set(lessonEntriesLoading);
    }
  }

  function prepareEntry(e) {
    return {
      ...e,
      theme: Number(e.theme_id) === TOP_5000_ID ? "Top 5000" : e.theme,
      category: e.category === "SilentShuffle" ? "Top 5000" : (e.category || "Top 5000"),
      english_senses: Array.isArray(e.english_senses) && e.english_senses.length
        ? e.english_senses
        : (e.english ? e.english.split(/\s*;\s*/).filter(Boolean) : []),
      groupKeys: e.groupKeys?.length ? e.groupKeys : groupKeysFrom(e.subsection),
    };
  }

  function prepareThemes(rawThemes) {
    // Drop the raw aggregate Top 5000 theme (id=13) from the list view; users
    // browse it via the 20 sub-themes (1301-1320) instead.
    const working = rawThemes
      .filter(t => Number(t.id) !== TOP_5000_ID)
      .map(t => ({
        ...t,
        entry_count: t.entry_count ?? 0,
        translated_count: t.translated_count ?? 0,
        audio_count: t.audio_count ?? 0,
        course: t.course || COURSE_DEFS.find(c => c.ids(Number(t.id)))?.name || "Other",
      }));

    // If the backfill script has run, the 20 Top 5000 sub-theme docs already
    // exist in Firestore with accurate stats + rankStart/rankEnd. If it hasn't,
    // synthesize them here so the courses page still renders.
    const existingIds = new Set(working.map(t => Number(t.id)));
    for (let i = 0; i < 20; i++) {
      const id = TOP_5000_SUB_BASE + i + 1;
      if (existingIds.has(id)) continue;
      const rankStart = i * TOP_5000_CHUNK + 1;
      const rankEnd = (i + 1) * TOP_5000_CHUNK;
      working.push({
        id,
        title: `Words ${rankStart}–${rankEnd}`,
        course: "Top 5000",
        rankStart,
        rankEnd,
        entry_count: TOP_5000_CHUNK,
        translated_count: TOP_5000_CHUNK,
        audio_count: 0,
      });
    }

    return working.sort((a, b) => {
      const courseOrder = COURSE_DEFS.map(c => c.name);
      const ca = courseOrder.indexOf(a.course);
      const cb = courseOrder.indexOf(b.course);
      if (ca !== cb) return ca - cb;
      return Number(a.id) - Number(b.id);
    });
  }

  function groupKeysFrom(v) {
    if (!v) return [];
    return String(v).toLowerCase().replace(/\bpl\.?/g, "").replace(/\bas\s+adj\.?/g, "adj").replace(/\bimp\.\s*v\.?/g, "v").replace(/,/g, "/").split("/").map(p => p.replace(/[^a-z. ]/g, " ").trim()).flatMap(p => p.split(/\s+/)).map(p => p.replace(/\.$/, "")).filter(p => p === "inter" || p === "int" ? "interj" : p).filter(p => displayGroup(p) !== p);
  }

  function loadStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const path = window.location.pathname;
    const lessonMatch = path.match(/^\/lesson\/(\d+)/);
    const tabMatch = path.match(/^\/lesson\/\d+\/(\w+)/);
    const courseMatch = path.match(/^\/course\/(.+)/);

    if (lessonMatch) {
      selectedLessonId = Number(lessonMatch[1]);
      view = "study";
      activeTab = tabMatch?.[1] || "cards";
      if (themes) {
        const t = themes.find(th => Number(th.id) === selectedLessonId);
        selectedCourse = t?.course ?? selectedCourse;
      }
    } else if (courseMatch) {
      selectedCourse = decodeURIComponent(courseMatch[1]);
      view = "lessons";
    } else {
      view = "courses";
    }

    selectedType = params.get("type") || "all";
    selectedGroup = params.get("group") || "all";
    globalSearch = params.get("q") || "";
    cardMode = params.get("dir") || "gr-en";
    translatedOnly = !params.has("all");
    cardIndex = Math.max(0, Number(params.get("card")) - 1);
  }

  function commitUrl(push = false) {
    const params = new URLSearchParams();
    if (selectedType !== "all") params.set("type", selectedType);
    if (selectedGroup !== "all") params.set("group", selectedGroup);
    if (globalSearch) params.set("q", globalSearch);
    if (!translatedOnly) params.set("all", "1");
    if (cardMode !== "gr-en") params.set("dir", cardMode);
    if (cardIndex > 0) params.set("card", cardIndex + 1);

    let url;
    if (view === "courses") url = "/";
    else if (view === "lessons") url = `/course/${encodeURIComponent(selectedCourse ?? "")}`;
    else url = `/lesson/${selectedLessonId}/${activeTab}`;

    const searchStr = params.toString();
    url += searchStr ? "?" + searchStr : "";

    if (push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }

  function openCourse(name) {
    selectedCourse = name;
    view = "lessons";
    commitUrl(true);
  }

  function openLesson(id) {
    selectedLessonId = id;
    view = "study";
    activeTab = "cards";
    cardIndex = 0;
    cardFlipped = false;
    commitUrl(true);
  }

  function showCourses() {
    view = "courses";
    selectedCourse = null;
    selectedLessonId = null;
    commitUrl(true);
  }

  function showLessons() {
    view = "lessons";
    selectedLessonId = null;
    commitUrl(true);
  }

  function setTab(tab) {
    activeTab = tab;
    if (window.innerWidth < 768) lessonSidebarOpen = false;
    commitUrl(true);
  }

  async function playAudio(entry) {
    if (!entry?.audio_path) return;
    if (currentAudio) currentAudio.pause();
    const bucket = "didibros-6d3ed.firebasestorage.app";
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(entry.audio_path)}?alt=media`;
    const audio = new Audio(url);
    currentAudio = audio;
    audioLoadingId = entry.id;
    audio.onended = () => { if (currentAudio === audio) audioLoadingId = null; };
    try { await audio.play(); } catch (e) {} finally { if (currentAudio === audio) audioLoadingId = null; }
  }

  function handleKeydown(e) {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
    if (e.key === "?" || e.key === "h") shortcutsOpen = !shortcutsOpen;
    if (view === "study" && activeTab === "cards") {
      if (e.key === "ArrowLeft") moveCard(-1);
      if (e.key === "ArrowRight") moveCard(1);
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); cardFlipped = !cardFlipped; }
    }
  }

  function moveCard(delta) {
    if (!deck.length) return;
    cardIndex = (cardIndex + delta + deck.length) % deck.length;
    cardFlipped = false;
    commitUrl();
  }

  function openEdit(entry) {
    editingEntry = JSON.parse(JSON.stringify(entry));
    aiEditPrompt = '';
    aiEditError = '';
  }
  function closeEdit() { editingEntry = null; }
  async function saveEdit() {
    if (!editingEntry) return;
    await updateDoc(doc(db, "entries", String(editingEntry.id)), { english_senses: editingEntry.english_senses || [], image: editingEntry.image || null });
    // Patch the entry wherever it currently sits in the per-lesson cache.
    // An entry can live in two caches at once for Top 5000 (raw theme 13 + sub-theme).
    for (const [lid, entries] of lessonEntriesCache.entries()) {
      if (entries.some(e => e.id === editingEntry.id)) {
        lessonEntriesCache.set(lid, entries.map(e => e.id === editingEntry.id ? { ...e, ...editingEntry } : e));
      }
    }
    lessonEntriesCache = new Map(lessonEntriesCache);
    closeEdit();
  }

  async function applyAiEditAssist() {
    if (!editingEntry || !aiEditPrompt.trim() || aiEditGenerating) return;
    aiEditGenerating = true;
    aiEditError = '';
    try {
      const senses = await aiAssistVocabEntry({ entry: editingEntry, prompt: aiEditPrompt });
      editingEntry = { ...editingEntry, english_senses: senses };
      aiEditPrompt = '';
    } catch (e) {
      aiEditError = e.message || 'AI assist failed.';
    } finally {
      aiEditGenerating = false;
    }
  }

  function openAddVocab() {
    addVocabOpen = true;
    addVocabPrompt = '';
    addVocabSuggestions = [];
    addVocabSelected = new Set();
    addVocabError = '';
  }
  function closeAddVocab() { addVocabOpen = false; }

  async function generateVocabAI() {
    if (!selectedLesson || !addVocabPrompt.trim() || addVocabGenerating) return;
    addVocabGenerating = true;
    addVocabError = '';
    try {
      addVocabSuggestions = await generateVocabSuggestions({ lesson: selectedLesson, entries: lessonEntries, prompt: addVocabPrompt });
      addVocabSelected = new Set(addVocabSuggestions.map((_, i) => i));
    } catch (e) {
      addVocabError = e.message || 'Generation failed.';
    } finally {
      addVocabGenerating = false;
    }
  }

  async function saveSelectedVocab() {
    if (addVocabSaving) return;
    addVocabSaving = true;
    addVocabError = '';
    try {
      const toSave = addVocabSuggestions.filter((_, i) => addVocabSelected.has(i));
      const saved = await Promise.all(toSave.map(s => saveNewVocabEntry({ entry: s, lessonId: selectedLessonId })));
      const id = Number(selectedLessonId);
      const cur = lessonEntriesCache.get(id) ?? [];
      lessonEntriesCache.set(id, [...cur, ...saved.map(prepareEntry)]);
      lessonEntriesCache = new Map(lessonEntriesCache);
      // Reflect new entry count in the theme list
      themes = themes.map(t => Number(t.id) === id
        ? { ...t, entry_count: (t.entry_count ?? 0) + saved.length, translated_count: (t.translated_count ?? 0) + saved.length }
        : t);
      closeAddVocab();
    } catch (e) {
      addVocabError = e.message || 'Save failed.';
    } finally {
      addVocabSaving = false;
    }
  }

  function toggleSuggestion(i) {
    const next = new Set(addVocabSelected);
    if (next.has(i)) next.delete(i); else next.add(i);
    addVocabSelected = next;
  }

  // --- Generate Lesson ---
  function openGenLesson() {
    genLessonOpen = true; genLessonPrompt = ''; genLessonResult = null;
    genLessonTitle = ''; genLessonSelected = new Set(); genLessonError = '';
  }
  function closeGenLesson() { genLessonOpen = false; }

  async function runGenLesson() {
    if (!genLessonPrompt.trim() || genLessonGenerating) return;
    genLessonGenerating = true; genLessonError = '';
    try {
      const result = await generateLessonContent({
        prompt: genLessonPrompt,
        courseName: selectedCourse || '',
        lessonTitles: courseLessons.map(l => l.title),
        generateCourseName: false,
      });
      genLessonResult = result;
      genLessonTitle = result.lessonTitle;
      genLessonSelected = new Set(result.entries.map((_, i) => i));
    } catch (e) { genLessonError = e.message || 'Generation failed.'; }
    finally { genLessonGenerating = false; }
  }

  async function saveGenLesson() {
    if (genLessonSaving || !genLessonResult) return;
    genLessonSaving = true; genLessonError = '';
    try {
      const toSave = genLessonResult.entries.filter((_, i) => genLessonSelected.has(i));
      const { theme, entries: saved } = await saveNewLesson({
        lessonTitle: genLessonTitle,
        courseName: selectedCourse,
        entries: toSave,
      });
      themes = [...themes, { ...theme, groupKeys: [] }];
      lessonEntriesCache.set(Number(theme.id), saved.map(prepareEntry));
      lessonEntriesCache = new Map(lessonEntriesCache);
      closeGenLesson();
    } catch (e) { genLessonError = e.message || 'Save failed.'; }
    finally { genLessonSaving = false; }
  }

  // --- Generate Course ---
  function openGenCourse() {
    genCourseOpen = true; genCoursePrompt = ''; genCourseResult = null;
    genCourseName = ''; genCourseLessonTitle = ''; genCourseSelected = new Set(); genCourseError = '';
  }
  function closeGenCourse() { genCourseOpen = false; }

  async function runGenCourse() {
    if (!genCoursePrompt.trim() || genCourseGenerating) return;
    genCourseGenerating = true; genCourseError = '';
    try {
      const result = await generateLessonContent({
        prompt: genCoursePrompt,
        courseName: '',
        lessonTitles: [],
        generateCourseName: true,
      });
      genCourseResult = result;
      genCourseName = result.courseName || 'New Course';
      genCourseLessonTitle = result.lessonTitle;
      genCourseSelected = new Set(result.entries.map((_, i) => i));
    } catch (e) { genCourseError = e.message || 'Generation failed.'; }
    finally { genCourseGenerating = false; }
  }

  async function saveGenCourse() {
    if (genCourseSaving || !genCourseResult) return;
    genCourseSaving = true; genCourseError = '';
    try {
      const toSave = genCourseResult.entries.filter((_, i) => genCourseSelected.has(i));
      const { theme, entries: saved } = await saveNewLesson({
        lessonTitle: genCourseLessonTitle,
        courseName: genCourseName,
        entries: toSave,
      });
      themes = [...themes, { ...theme, groupKeys: [] }];
      lessonEntriesCache.set(Number(theme.id), saved.map(prepareEntry));
      lessonEntriesCache = new Map(lessonEntriesCache);
      closeGenCourse();
    } catch (e) { genCourseError = e.message || 'Save failed.'; }
    finally { genCourseSaving = false; }
  }

  $: courses = (() => {
    if (!themes) return [];
    const map = new Map();
    for (const t of themes) {
      const c = t.course ?? "Other";
      if (!map.has(c)) map.set(c, { name: c, lessons: [] });
      map.get(c).lessons.push(t);
    }
    const order = COURSE_DEFS.map(d => d.name);
    return [...map.values()].sort((a, b) => {
      const ai = order.indexOf(a.name), bi = order.indexOf(b.name);
      if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  })();

  $: courseLessons = themes?.filter(t => t.course === selectedCourse) ?? [];
  $: selectedLesson = themes?.find(t => Number(t.id) === Number(selectedLessonId));
  $: lessonEntries = selectedLessonId ? (lessonEntriesCache.get(Number(selectedLessonId)) ?? []) : [];
  $: lessonEntriesReady = selectedLessonId ? lessonEntriesCache.has(Number(selectedLessonId)) : false;

  // Reactive trigger: when a lesson is selected (or the URL changes to one),
  // fetch its entries lazily. Cached afterwards for instant back-navigation.
  $: if (selectedLessonId && themes) loadLessonEntries(selectedLessonId);
  
  $: filteredEntries = lessonEntries.filter(e => {
    if (translatedOnly && !e.english) return false;
    if (selectedType !== "all" || selectedGroup !== "all") {
      const filter = selectedType !== "all" ? displayType(selectedType) : displayGroup(selectedGroup);
      const cat = displayType(e.category);
      const tags = e.groupKeys.map(displayGroup);
      if (![cat, ...tags].some(t => t.toLowerCase().includes(filter.toLowerCase()))) return false;
    }
    if (globalSearch) {
      const fields = [e.term, e.lemma, e.english, ...e.english_senses].filter(Boolean).join(" ");
      if (!textMatchesSearch(fields, globalSearch)) return false;
    }
    return true;
  });

  $: deck = filteredEntries;

  $: filters = (() => {
    const types = [...new Set(lessonEntries.map(e => e.category))].filter(Boolean).map(t => ({ id: t, label: displayType(t), kind: "type" }));
    const groups = [...new Set(lessonEntries.flatMap(e => e.groupKeys))].filter(Boolean).map(g => ({ id: g, label: displayGroup(g), kind: "group" }));
    return [...types, ...groups].sort((a,b) => a.label.localeCompare(b.label));
  })();

  onMount(loadThemes);
</script>

<svelte:window on:keydown={handleKeydown} on:popstate={loadStateFromUrl} />

<div class="app-shell">
  <header class="app-header">
    <div class="nav-left">
      <button class="brand" on:click={showCourses}>
        <img src="/fanari-icon.png" alt="" class="icon" />
        <span>Fanari Go</span>
      </button>

      {#if view === "lessons" && selectedCourse}
        <div class="lesson-indicator">
          <span class="sep">/</span>
          <span class="lesson-title">{selectedCourse}</span>
        </div>
      {/if}

      {#if view === "study" && selectedLesson}
        <div class="lesson-indicator">
          <span class="sep">/</span>
          <button class="crumb-btn" on:click={showLessons}>{selectedLesson.course}</button>
          <span class="sep">/</span>
          <span class="lesson-title">{selectedLesson.title}</span>
        </div>
      {/if}
    </div>

    <div class="nav-right">
      <button class="icon-btn" on:click={() => shortcutsOpen = true} title="Help">
        <Keyboard size={20} />
      </button>
    </div>
  </header>

  <main class="app-main" class:study={view === 'study'}>
    {#if !themes}
      <div class="loading-state">
        <LoaderCircle class="animate-spin" size={48} />
        <p>Illuminating vocabulary...</p>
      </div>
    {:else if view === "courses"}
      <CourseList {courses} onOpenCourse={openCourse} onGenerateCourse={openGenCourse} />
    {:else if view === "lessons"}
      <LessonList lessons={courseLessons} courseName={selectedCourse ?? ""} onOpenLesson={openLesson} onBack={showCourses} onGenerateLesson={openGenLesson} />
    {:else}
      <div class="study-layout">
        <aside class="sidebar" class:open={lessonSidebarOpen}>
          <button class="back-btn" on:click={showLessons}>
            <Home size={18} />
            <span>{selectedLesson?.course ?? "Lessons"}</span>
          </button>

          <nav class="tabs-nav">
            <button class:active={activeTab === 'vocab'} on:click={() => setTab('vocab')}>
              <Layers3 size={18} /> <span>Vocabulary</span>
            </button>
            <button class:active={activeTab === 'cards'} on:click={() => setTab('cards')}>
              <BookOpen size={18} /> <span>Flashcards</span>
            </button>
            <button class:active={activeTab === 'games'} on:click={() => setTab('games')}>
              <Sparkles size={18} /> <span>Games</span>
            </button>
            <button class:active={activeTab === 'plans'} on:click={() => setTab('plans')}>
              <GraduationCap size={18} /> <span>Plans</span>
            </button>
          </nav>

          <div class="filter-section">
            <h3 class="section-label">Filters</h3>
            <label class="check-row">
              <input type="checkbox" bind:checked={translatedOnly} />
              <span>With meanings only</span>
            </label>
            
            <div class="chips-grid">
              <button class="chip" class:active={selectedType==='all'&&selectedGroup==='all'} on:click={() => {selectedType='all'; selectedGroup='all';}}>All</button>
              {#each filters as f}
                <button class="chip" class:active={selectedType===f.id||selectedGroup===f.id} on:click={() => {if(f.kind==='type'){selectedType=f.id;selectedGroup='all'}else{selectedGroup=f.id;selectedType='all'}}}>
                  {f.label}
                </button>
              {/each}
            </div>
          </div>
        </aside>

        <div class="content-area">
          {#if lessonSidebarOpen}
            <div class="sidebar-backdrop" on:click={() => lessonSidebarOpen = false}></div>
          {/if}
          <header class="content-header">
            <button class="toggle-sidebar" on:click={() => lessonSidebarOpen = !lessonSidebarOpen}>
              <Menu size={20} />
            </button>
            <h1 class="page-title">{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h1>
            {#if activeTab === 'vocab' && selectedLesson}
              <button class="add-vocab-btn" type="button" on:click={openAddVocab}>
                <Sparkles size={14} /> Add Words
              </button>
            {/if}
          </header>

          <div class="page-container">
            {#if lessonEntriesError}
              <div class="loading-state"><p style="color:#a24f3f">Could not load this lesson: {lessonEntriesError}</p></div>
            {:else if !lessonEntriesReady}
              <div class="loading-state"><LoaderCircle class="animate-spin" size={36} /><p>Loading vocabulary…</p></div>
            {:else if activeTab === 'cards'}
              <FlashcardsPage 
                {deck} {cardIndex} {cardFlipped} {cardMode} {imageMode} {audioLoadingId}
                onMoveCard={moveCard}
                onFlipCard={() => cardFlipped = !cardFlipped}
                onShuffleDeck={() => { deck = [...deck].sort(() => Math.random() - 0.5); cardIndex = 0; }}
                onSetCardMode={m => cardMode = m}
                onPlayAudio={playAudio}
                onOpenEdit={openEdit}
                onSetImageMode={m => imageMode = m}
              />
            {:else if activeTab === 'games'}
              <AIPractice 
                lesson={selectedLesson} 
                entries={lessonEntries}
                onExerciseChange={e => currentExercise = e}
              />
            {:else if activeTab === 'vocab'}
              <VocabPage
                entries={filteredEntries}
                showGroupFilter={selectedLessonId === TOP_5000_ID}
                {imageMode} {audioLoadingId}
                onPlayAudio={playAudio}
                onOpenEdit={openEdit}
              />
            {:else if activeTab === 'plans'}
              <PlansPage
                lesson={selectedLesson}
                entries={lessonEntries}
              />
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </main>

  <YiaYiaChat
    lesson={selectedLesson}
    exercise={currentExercise}
    entries={lessonEntries}
    contextLabel={activeTab === 'games' ? currentExercise?.title : selectedLesson?.title}
    contextWords={activeTab === 'cards' ? [deck[cardIndex]?.lemma].filter(Boolean) : activeTab === 'games' ? [...(currentExercise?.requiredWords ?? []), ...(currentExercise?.vocabulary?.map(v => v.greek) ?? [])].filter(Boolean).slice(0, 6) : []}
    contextType={activeTab === 'games' ? currentExercise?.type : null}
  />
</div>

{#if shortcutsOpen}
  <div class="modal-overlay" on:click={() => shortcutsOpen = false}>
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Keyboard Shortcuts</h2>
        <button on:click={() => shortcutsOpen = false}><X /></button>
      </div>
      <div class="modal-body shortcuts-body">
        <div class="shortcut-row"><kbd>?</kbd> / <kbd>H</kbd><span>Toggle this help</span></div>
        <div class="shortcut-row"><kbd>←</kbd> <kbd>→</kbd><span>Previous / next card</span></div>
        <div class="shortcut-row"><kbd>Space</kbd> / <kbd>Enter</kbd><span>Flip card</span></div>
      </div>
    </div>
  </div>
{/if}

{#if editingEntry}
  <div class="modal-overlay" on:click={closeEdit}>
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Edit: {editingEntry.article ? editingEntry.article + ' ' : ''}{editingEntry.lemma}</h2>
        <button on:click={closeEdit}><X /></button>
      </div>
      <div class="modal-body">
        <label>Lemma <input bind:value={editingEntry.lemma} /></label>
        <div class="senses-edit">
          <p>Meanings</p>
          {#each editingEntry.english_senses as s, i}
            <div class="sense-row">
              <input bind:value={editingEntry.english_senses[i]} />
              <button on:click={() => editingEntry.english_senses = editingEntry.english_senses.filter((_,j)=>i!==j)}><Trash2 size={14}/></button>
            </div>
          {/each}
          <button class="add-btn" on:click={() => editingEntry.english_senses = [...editingEntry.english_senses, ""]}>+ Add Meaning</button>
        </div>
        <div class="ai-assist-section">
          <p class="ai-assist-label"><Sparkles size={12} /> AI Assist</p>
          <div class="ai-assist-row">
            <input
              class="ai-assist-input"
              type="text"
              placeholder="e.g. 'add formal/informal usage', 'improve these definitions'…"
              bind:value={aiEditPrompt}
              on:keydown={(e) => { if (e.key === 'Enter') applyAiEditAssist(); }}
              disabled={aiEditGenerating}
            />
            <button
              class="ai-assist-btn"
              type="button"
              disabled={aiEditGenerating || !aiEditPrompt.trim()}
              on:click={applyAiEditAssist}
            >
              {#if aiEditGenerating}
                <LoaderCircle class="animate-spin" size={13} /> Working…
              {:else}
                Apply
              {/if}
            </button>
          </div>
          {#if aiEditError}<p class="ai-error">{aiEditError}</p>{/if}
        </div>

        <div class="image-section">
          <p class="image-section-label"><ImageIcon size={12} /> Image</p>
          {#if editingEntry.image}
            <div class="image-current">
              <img src={editingEntry.image.thumbnail || editingEntry.image.url} alt="current" />
              <div class="image-current-actions">
                <button class="img-action-btn" on:click={openImagePicker}><ImageIcon size={13} /> Replace</button>
                <button class="img-action-btn img-remove-btn" on:click={removeImage}><X size={13} /> Remove</button>
              </div>
            </div>
          {:else}
            <button class="add-btn" on:click={openImagePicker}><ImageIcon size={13} /> Add Image from Pexels</button>
          {/if}

          {#if imagePickerOpen}
            <div class="image-picker">
              <div class="ai-assist-row">
                <input
                  class="ai-assist-input"
                  type="text"
                  placeholder="Search Pexels…"
                  bind:value={imagePickerQuery}
                  on:keydown={(e) => { if (e.key === 'Enter') searchPexelsImages(); }}
                  disabled={imagePickerLoading}
                />
                <button class="ai-assist-btn" type="button" disabled={imagePickerLoading || !imagePickerQuery.trim()} on:click={searchPexelsImages}>
                  {#if imagePickerLoading}<LoaderCircle class="animate-spin" size={13} />{:else}Search{/if}
                </button>
              </div>
              {#if imagePickerError}<p class="ai-error">{imagePickerError}</p>{/if}
              {#if imagePickerResults.length}
                <div class="pexels-grid">
                  {#each imagePickerResults as photo}
                    <button class="pexels-thumb" on:click={() => pickPexelsImage(photo)} title={photo.photographer}>
                      <img src={photo.src.small} alt={photo.alt || photo.photographer} />
                    </button>
                  {/each}
                </div>
                <p class="pexels-credit">Photos from <a href="https://www.pexels.com" target="_blank" rel="noreferrer">Pexels</a></p>
              {/if}
            </div>
          {/if}
        </div>
      </div>
      <div class="modal-footer">
        <button class="cancel" on:click={closeEdit}>Cancel</button>
        <button class="save" on:click={saveEdit}>Save</button>
      </div>
    </div>
  </div>
{/if}

{#if addVocabOpen}
  <div class="modal-overlay" on:click={closeAddVocab}>
    <div class="modal-content modal-wide" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Add Words with AI</h2>
        <button on:click={closeAddVocab}><X /></button>
      </div>
      <div class="modal-body">
        <div class="add-vocab-prompt-row">
          <input
            class="add-vocab-input"
            type="text"
            placeholder="Describe words to add, e.g. 'months of the year' or 'ordering food at a restaurant'…"
            bind:value={addVocabPrompt}
            on:keydown={(e) => { if (e.key === 'Enter') generateVocabAI(); }}
            disabled={addVocabGenerating}
          />
          <button
            class="add-vocab-gen-btn"
            type="button"
            disabled={addVocabGenerating || !addVocabPrompt.trim()}
            on:click={generateVocabAI}
          >
            {#if addVocabGenerating}
              <LoaderCircle class="animate-spin" size={13} /> Generating…
            {:else}
              <Sparkles size={13} /> Generate
            {/if}
          </button>
        </div>
        {#if addVocabError}<p class="ai-error">{addVocabError}</p>{/if}

        {#if addVocabSuggestions.length}
          <div class="suggestions-header">
            <span>{addVocabSelected.size} of {addVocabSuggestions.length} selected</span>
            <div class="suggestions-select-btns">
              <button type="button" on:click={() => addVocabSelected = new Set(addVocabSuggestions.map((_,i)=>i))}>All</button>
              <button type="button" on:click={() => addVocabSelected = new Set()}>None</button>
            </div>
          </div>
          <div class="suggestions-list">
            {#each addVocabSuggestions as s, i}
              <label class="suggestion-row" class:selected={addVocabSelected.has(i)}>
                <input type="checkbox" checked={addVocabSelected.has(i)} on:change={() => toggleSuggestion(i)} />
                <div class="suggestion-body">
                  <div class="suggestion-greek">
                    {#if s.article}<span class="sug-article">{s.article}</span>{/if}
                    <span class="sug-lemma">{s.lemma}</span>
                    <span class="sug-cat">{s.category}</span>
                  </div>
                  <div class="suggestion-english">{(s.english_senses || []).join(' · ')}</div>
                  {#if s.notes}<div class="suggestion-notes">{s.notes}</div>{/if}
                </div>
              </label>
            {/each}
          </div>
        {/if}
      </div>
      {#if addVocabSuggestions.length}
        <div class="modal-footer">
          <button class="cancel" on:click={closeAddVocab}>Cancel</button>
          <button class="save" disabled={addVocabSelected.size === 0 || addVocabSaving} on:click={saveSelectedVocab}>
            {#if addVocabSaving}
              <LoaderCircle class="animate-spin" size={13} /> Saving…
            {:else}
              Save {addVocabSelected.size} word{addVocabSelected.size !== 1 ? 's' : ''}
            {/if}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if genLessonOpen}
  {@const result = genLessonResult}
  <div class="modal-overlay" on:click={closeGenLesson}>
    <div class="modal-content modal-wide" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Generate Lesson — {selectedCourse}</h2>
        <button on:click={closeGenLesson}><X /></button>
      </div>
      <div class="modal-body">
        <div class="add-vocab-prompt-row">
          <input class="add-vocab-input" type="text"
            placeholder="Describe the lesson, e.g. 'Greek verbs of motion' or 'colors and adjectives'…"
            bind:value={genLessonPrompt}
            on:keydown={(e) => { if (e.key === 'Enter') runGenLesson(); }}
            disabled={genLessonGenerating} />
          <button class="add-vocab-gen-btn" type="button"
            disabled={genLessonGenerating || !genLessonPrompt.trim()} on:click={runGenLesson}>
            {#if genLessonGenerating}
              <LoaderCircle class="animate-spin" size={13} /> Generating…
            {:else}
              <Sparkles size={13} /> Generate
            {/if}
          </button>
        </div>
        {#if genLessonError}<p class="ai-error">{genLessonError}</p>{/if}
        {#if result}
          <label class="gen-title-label">Lesson title
            <input class="gen-title-input" type="text" bind:value={genLessonTitle} />
          </label>
          <div class="suggestions-header">
            <span>{genLessonSelected.size} of {result.entries.length} words selected</span>
            <div class="suggestions-select-btns">
              <button type="button" on:click={() => genLessonSelected = new Set(result.entries.map((_,i)=>i))}>All</button>
              <button type="button" on:click={() => genLessonSelected = new Set()}>None</button>
            </div>
          </div>
          <div class="suggestions-list">
            {#each result.entries as s, i}
              <label class="suggestion-row" class:selected={genLessonSelected.has(i)}>
                <input type="checkbox" checked={genLessonSelected.has(i)} on:change={() => { const n = new Set(genLessonSelected); n.has(i) ? n.delete(i) : n.add(i); genLessonSelected = n; }} />
                <div class="suggestion-body">
                  <div class="suggestion-greek">
                    {#if s.article}<span class="sug-article">{s.article}</span>{/if}
                    <span class="sug-lemma">{s.lemma}</span>
                    <span class="sug-cat">{s.category}</span>
                  </div>
                  <div class="suggestion-english">{(s.english_senses || []).join(' · ')}</div>
                  {#if s.notes}<div class="suggestion-notes">{s.notes}</div>{/if}
                </div>
              </label>
            {/each}
          </div>
        {/if}
      </div>
      {#if result}
        <div class="modal-footer">
          <button class="cancel" on:click={closeGenLesson}>Cancel</button>
          <button class="save" disabled={genLessonSelected.size === 0 || genLessonSaving || !genLessonTitle.trim()} on:click={saveGenLesson}>
            {#if genLessonSaving}
              <LoaderCircle class="animate-spin" size={13} /> Saving…
            {:else}
              Create lesson ({genLessonSelected.size} words)
            {/if}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if genCourseOpen}
  {@const result = genCourseResult}
  <div class="modal-overlay" on:click={closeGenCourse}>
    <div class="modal-content modal-wide" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Generate New Course</h2>
        <button on:click={closeGenCourse}><X /></button>
      </div>
      <div class="modal-body">
        <div class="add-vocab-prompt-row">
          <input class="add-vocab-input" type="text"
            placeholder="Describe the course, e.g. 'Greek food and cooking vocabulary' or 'travel and transportation'…"
            bind:value={genCoursePrompt}
            on:keydown={(e) => { if (e.key === 'Enter') runGenCourse(); }}
            disabled={genCourseGenerating} />
          <button class="add-vocab-gen-btn" type="button"
            disabled={genCourseGenerating || !genCoursePrompt.trim()} on:click={runGenCourse}>
            {#if genCourseGenerating}
              <LoaderCircle class="animate-spin" size={13} /> Generating…
            {:else}
              <Sparkles size={13} /> Generate
            {/if}
          </button>
        </div>
        {#if genCourseError}<p class="ai-error">{genCourseError}</p>{/if}
        {#if result}
          <div class="gen-two-col">
            <label class="gen-title-label">Course name
              <input class="gen-title-input" type="text" bind:value={genCourseName} />
            </label>
            <label class="gen-title-label">First lesson title
              <input class="gen-title-input" type="text" bind:value={genCourseLessonTitle} />
            </label>
          </div>
          <div class="suggestions-header">
            <span>{genCourseSelected.size} of {result.entries.length} words selected</span>
            <div class="suggestions-select-btns">
              <button type="button" on:click={() => genCourseSelected = new Set(result.entries.map((_,i)=>i))}>All</button>
              <button type="button" on:click={() => genCourseSelected = new Set()}>None</button>
            </div>
          </div>
          <div class="suggestions-list">
            {#each result.entries as s, i}
              <label class="suggestion-row" class:selected={genCourseSelected.has(i)}>
                <input type="checkbox" checked={genCourseSelected.has(i)} on:change={() => { const n = new Set(genCourseSelected); n.has(i) ? n.delete(i) : n.add(i); genCourseSelected = n; }} />
                <div class="suggestion-body">
                  <div class="suggestion-greek">
                    {#if s.article}<span class="sug-article">{s.article}</span>{/if}
                    <span class="sug-lemma">{s.lemma}</span>
                    <span class="sug-cat">{s.category}</span>
                  </div>
                  <div class="suggestion-english">{(s.english_senses || []).join(' · ')}</div>
                  {#if s.notes}<div class="suggestion-notes">{s.notes}</div>{/if}
                </div>
              </label>
            {/each}
          </div>
        {/if}
      </div>
      {#if result}
        <div class="modal-footer">
          <button class="cancel" on:click={closeGenCourse}>Cancel</button>
          <button class="save" disabled={genCourseSelected.size === 0 || genCourseSaving || !genCourseName.trim() || !genCourseLessonTitle.trim()} on:click={saveGenCourse}>
            {#if genCourseSaving}
              <LoaderCircle class="animate-spin" size={13} /> Saving…
            {:else}
              Create course ({genCourseSelected.size} words)
            {/if}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  :global(body) { margin: 0; background: #f7f8fb; overflow: hidden; }
  .app-shell { display: flex; flex-direction: column; height: 100vh; font-family: Inter, sans-serif; }
  .app-header { height: 56px; background: #fff; border-bottom: 1px solid #d9dee7; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; flex-shrink: 0; z-index: 100; }
  .nav-left { display: flex; align-items: center; gap: 12px; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 800; color: #17614f; border: none; background: none; cursor: pointer; padding: 0; }
  .brand .icon { height: 28px; width: 28px; }
  .lesson-indicator { display: flex; align-items: center; gap: 6px; color: #667085; font-size: 14px; font-weight: 600; overflow: hidden; }
  .lesson-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
  .crumb-btn { background: none; border: none; cursor: pointer; color: #667085; font-size: 14px; font-weight: 600; padding: 0; white-space: nowrap; }
  .crumb-btn:hover { color: #202124; text-decoration: underline; }
  .nav-right { display: flex; gap: 8px; }
  .icon-btn { width: 36px; height: 36px; border-radius: 8px; border: 1px solid #d9dee7; background: #fff; color: #667085; cursor: pointer; display: grid; place-items: center; }
  
  .app-main { flex: 1; overflow-y: auto; position: relative; }
  .app-main.study { overflow: hidden; }
  .loading-state { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; color: #17614f; font-weight: 700; }
  
  .study-layout { display: flex; height: 100%; overflow: hidden; }
  .sidebar { width: 260px; background: #fff; border-right: 1px solid #d9dee7; display: flex; flex-direction: column; transition: transform 0.3s; flex-shrink: 0; z-index: 50; }
  .sidebar:not(.open) { transform: translateX(-100%); width: 0; padding: 0; overflow: hidden; border-right: none; }
  
  .back-btn { margin: 16px; height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border-radius: 8px; border: 1px solid #d9dee7; background: #f7f8fb; color: #202124; font-weight: 700; cursor: pointer; }
  .tabs-nav { padding: 0 16px; display: flex; flex-direction: column; gap: 4px; margin-bottom: 24px; }
  .tabs-nav button { height: 44px; display: flex; align-items: center; gap: 12px; padding: 0 12px; border-radius: 8px; border: none; background: transparent; color: #667085; font-weight: 700; cursor: pointer; text-align: left; transition: all 0.2s; }
  .tabs-nav button.active { background: #f0f4f3; color: #17614f; }
  
  .filter-section { padding: 0 16px; overflow-y: auto; flex: 1; }
  .section-label { font-size: 11px; font-weight: 800; text-transform: uppercase; color: #99a1b3; margin-bottom: 12px; }
  .check-row { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #202124; margin-bottom: 16px; cursor: pointer; }
  .chips-grid { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 20px; }
  .chip { padding: 6px 12px; border-radius: 6px; border: 1px solid #d9dee7; background: #f7f8fb; font-size: 12px; font-weight: 700; color: #667085; cursor: pointer; }
  .chip.active { background: #17614f; color: #fff; border-color: #17614f; }
  
  .content-area { flex: 1; display: flex; flex-direction: column; min-width: 0; background: #f7f8fb; position: relative; }
  .content-header { height: 48px; border-bottom: 1px solid #e5e8ef; background: #fff; display: flex; align-items: center; padding: 0 16px; gap: 12px; flex-shrink: 0; }
  .toggle-sidebar { border: none; background: none; color: #667085; cursor: pointer; display: grid; place-items: center; }
  .page-title { font-size: 16px; font-weight: 800; color: #202124; margin: 0; }
  .page-container { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
  
  .modal-overlay { position: fixed; inset: 0; background: rgba(32,33,36,0.4); backdrop-filter: blur(4px); z-index: 1000; display: grid; place-items: center; padding: 16px; }
  .modal-content { width: 100%; max-width: 500px; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.2); }
  .modal-header { padding: 16px; border-bottom: 1px solid #e5e8ef; display: flex; justify-content: space-between; align-items: center; }
  .modal-header h2 { margin: 0; font-size: 18px; font-weight: 800; }
  .modal-header button { border: none; background: none; color: #667085; cursor: pointer; }
  .modal-body { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
  .modal-body label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 700; color: #667085; }
  .modal-body input { height: 40px; border-radius: 8px; border: 1px solid #d9dee7; padding: 0 12px; font-size: 14px; }
  .sense-row { display: flex; gap: 8px; }
  .sense-row input { flex: 1; }
  .sense-row button { width: 40px; border-radius: 8px; border: 1px solid #d9dee7; background: #fff; color: #a24f3f; cursor: pointer; }
  .add-btn { height: 36px; border-radius: 8px; border: 1px dashed #d9dee7; background: #f7f8fb; color: #17614f; font-weight: 700; cursor: pointer; }
  .modal-footer { padding: 16px; border-top: 1px solid #e5e8ef; display: flex; justify-content: flex-end; gap: 12px; background: #f7f8fb; }
  .modal-footer button { padding: 8px 20px; border-radius: 8px; font-weight: 700; cursor: pointer; }
  .modal-footer .cancel { border: none; background: transparent; color: #667085; }
  .modal-footer .save { border: none; background: #17614f; color: #fff; }

  .shortcuts-body { gap: 8px; }
  .shortcut-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f0f2f7; font-size: 14px; color: #202124; font-weight: 600; }
  .shortcut-row:last-child { border-bottom: none; }
  .shortcut-row span { margin-left: auto; color: #667085; font-weight: 500; }
  kbd { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; padding: 0 8px; border-radius: 6px; border: 1px solid #d9dee7; background: #f7f8fb; font-family: inherit; font-size: 12px; font-weight: 700; color: #202124; box-shadow: 0 1px 0 #d9dee7; }

  .sidebar-backdrop { display: none; }

  /* Add Words button */
  .add-vocab-btn {
    margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 12px; border-radius: 8px; border: none;
    background: #17614f; color: #fff; font-weight: 700; font-size: 12px; cursor: pointer;
  }
  .add-vocab-btn:hover { background: #145644; }

  /* AI Assist in edit modal */
  .ai-assist-section {
    border-top: 1px solid #ebeef4; padding-top: 14px; display: flex; flex-direction: column; gap: 8px;
  }
  .ai-assist-label {
    display: flex; align-items: center; gap: 5px;
    margin: 0; font-size: 11px; font-weight: 800; color: #17614f;
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .ai-assist-row { display: flex; gap: 8px; }
  .ai-assist-input {
    flex: 1; height: 36px; border-radius: 7px;
    border: 1px solid #d9dee7; padding: 0 10px;
    font-size: 13px; outline: none;
  }
  .ai-assist-input:focus { border-color: #17614f; }
  .ai-assist-btn {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 0 12px; height: 36px; border-radius: 7px; border: none;
    background: #17614f; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer;
    white-space: nowrap;
  }
  .ai-assist-btn:disabled { background: #c1c8d4; cursor: default; }
  .ai-error { margin: 4px 0 0; font-size: 12px; color: #a24f3f; font-weight: 600; }

  /* Add Vocab modal */
  .modal-wide { max-width: 640px; }

  .image-section { display: flex; flex-direction: column; gap: 8px; }
  .image-section-label { margin: 0; font-size: 12px; font-weight: 700; color: #667085; display: flex; align-items: center; gap: 4px; }
  .image-current { display: flex; align-items: center; gap: 12px; }
  .image-current img { width: 80px; height: 54px; object-fit: cover; border-radius: 6px; border: 1px solid #e5e8ef; }
  .image-current-actions { display: flex; gap: 6px; }
  .img-action-btn { display: flex; align-items: center; gap: 4px; padding: 5px 10px; border-radius: 8px; border: 1px solid #d9dee7; background: #fff; font-size: 12px; font-weight: 600; cursor: pointer; color: #344054; }
  .img-action-btn:hover { background: #f7f8fb; }
  .img-remove-btn { color: #a24f3f; border-color: #f5c0b0; }
  .img-remove-btn:hover { background: #fff5f3; }
  .image-picker { display: flex; flex-direction: column; gap: 10px; padding: 12px; background: #f7f8fb; border-radius: 10px; border: 1px solid #e5e8ef; }
  .pexels-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .pexels-thumb { padding: 0; border: 2px solid transparent; border-radius: 6px; overflow: hidden; cursor: pointer; background: none; transition: border-color 0.15s; }
  .pexels-thumb:hover { border-color: #17614f; }
  .pexels-thumb img { width: 100%; height: 70px; object-fit: cover; display: block; }
  .pexels-credit { margin: 0; font-size: 11px; color: #999; text-align: right; }
  .pexels-credit a { color: #17614f; }
  .add-vocab-prompt-row { display: flex; gap: 8px; }
  .add-vocab-input {
    flex: 1; height: 40px; border-radius: 8px;
    border: 1px solid #d9dee7; padding: 0 12px; font-size: 13px; outline: none;
  }
  .add-vocab-input:focus { border-color: #17614f; }
  .add-vocab-gen-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 0 14px; height: 40px; border-radius: 8px; border: none;
    background: #17614f; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer;
    white-space: nowrap;
  }
  .add-vocab-gen-btn:disabled { background: #c1c8d4; cursor: default; }

  .suggestions-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-top: 8px; font-size: 12px; color: #667085; font-weight: 700;
  }
  .suggestions-select-btns { display: flex; gap: 6px; }
  .suggestions-select-btns button {
    padding: 3px 8px; border-radius: 5px; border: 1px solid #d9dee7;
    background: #f7f8fb; font-size: 11px; font-weight: 700; color: #475467; cursor: pointer;
  }
  .suggestions-select-btns button:hover { background: #ebeef4; }

  .suggestions-list {
    display: flex; flex-direction: column; gap: 6px;
    max-height: 360px; overflow-y: auto; padding: 2px 0;
  }
  .suggestion-row {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 10px 12px; border-radius: 10px;
    border: 1px solid #ebeef4; background: #fff; cursor: pointer;
    transition: border-color 0.15s;
  }
  .suggestion-row.selected { border-color: #17614f; background: #f0f7f4; }
  .suggestion-row input[type="checkbox"] { margin-top: 3px; flex-shrink: 0; accent-color: #17614f; }
  .suggestion-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .suggestion-greek { display: flex; align-items: baseline; gap: 6px; }
  .sug-article { color: #99a1b3; font-family: Georgia, serif; font-size: 14px; }
  .sug-lemma { font-family: Georgia, serif; font-size: 16px; font-weight: 700; color: #17614f; }
  .sug-cat { font-size: 10px; font-weight: 800; color: #99a1b3; text-transform: uppercase; letter-spacing: 0.06em; }
  .suggestion-english { font-size: 13px; color: #344054; }
  .suggestion-notes { font-size: 11px; color: #99a1b3; font-style: italic; }

  /* Generate lesson/course */
  .gen-title-label {
    display: flex; flex-direction: column; gap: 5px;
    font-size: 11px; font-weight: 800; color: #667085; text-transform: uppercase; letter-spacing: 0.06em;
  }
  .gen-title-input {
    height: 40px; border-radius: 8px; border: 1px solid #d9dee7;
    padding: 0 12px; font-size: 14px; font-weight: 600; color: #202124; outline: none;
  }
  .gen-title-input:focus { border-color: #17614f; }
  .gen-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

  @media (max-width: 768px) {
    .sidebar { position: absolute; left: 0; top: 0; bottom: 0; transform: translateX(-100%); }
    .sidebar.open { transform: translateX(0); width: 260px; box-shadow: 20px 0 40px rgba(0,0,0,0.1); }
    .sidebar-backdrop { display: block; position: absolute; inset: 0; background: rgba(32,33,36,0.3); z-index: 10; }
  }
</style>
