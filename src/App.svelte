<script>
  import {
    BookOpen,
    ChevronLeft,
    ChevronRight,
    Home,
    Keyboard,
    Layers3,
    Languages,
    LoaderCircle,
    RotateCcw,
    Search,
    Shuffle,
    Volume2,
    X,
    Edit2,
    Image as ImageIcon,
    Upload,
    Plus,
    Trash2,
  } from "lucide-svelte";
  import { db, storage } from "./lib/firebase";
  import { collection, getDocs, doc, updateDoc, getDoc } from "firebase/firestore";
  import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

  const ENTRY_RENDER_LIMIT = 420;
  const STUDY_ENTRY_RENDER_LIMIT = 60;
  const TOP_5000_ID = 13;

  let data = null;
  let loadError = "";
  let view = "lessons";
  let selectedLessonId = null;
  let selectedType = "all";
  let selectedGroup = "all";
  let search = "";
  let translatedOnly = true;
  let cardsOpen = true;
  let showImages = true;
  let cardIndex = 0;
  let cardFlipped = false;
  let cardMode = "gr-en";
  let deckOrderIds = null;
  let currentAudio = null;
  let audioLoadingId = null;
  let shortcutsOpen = false;
  let pexelsCandidates = { entries: {} };
  let imagePreferences = { entries: {} };
  let editingEntry = null;
  let pexelsSearchQuery = "";
  let pexelsSearchResults = [];
  let pexelsSearching = false;
  let studyCardEl = null;
  let dragStart = null;
  let dragX = 0;
  let dragY = 0;
  let dragTransition = false;
  let suppressNextClick = false;

  const typeLabels = {
    "Ουσιαστικά": "Nouns",
    "Επίθετα": "Adjectives",
    "Ρήματα": "Verbs",
    "Εκφράσεις": "Phrases",
    "Top 5000": "Top 5000",
  };

  const groupLabels = {
    art: "Articles",
    part: "Particles",
    v: "Verbs",
    n: "Nouns",
    adj: "Adjectives",
    adv: "Adverbs",
    prep: "Prepositions",
    pron: "Pronouns",
    conj: "Conjunctions",
    interj: "Interjections",
    inter: "Interjections",
    int: "Interjections",
    det: "Determiners",
    num: "Numbers",
    coll: "Collective",
  };

  const cardModes = [
    { value: "gr-en", label: "Greek to English", short: "GR → EN" },
    { value: "en-gr", label: "English to Greek", short: "EN → GR" },
    { value: "mixed", label: "Mixed", short: "Mixed" },
  ];

  const normalise = (value) =>
    String(value ?? "")
      .toLocaleLowerCase("el")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");

  const cleanLessonTitle = (theme) =>
    Number(theme.id) === TOP_5000_ID ? "Top 5000" : theme.title;

  const cleanType = (value) => {
    if (!value || value === "SilentShuffle") return "Top 5000";
    return value;
  };

  const displayType = (value) => typeLabels[value] ?? value;

  function groupKeysFrom(value) {
    if (!value) return [];
    const normalized = String(value)
      .toLowerCase()
      .replace(/\bpl\.?/g, "")
      .replace(/\bas\s+adj\.?/g, "adj")
      .replace(/\bimp\.\s*v\.?/g, "v")
      .replace(/,/g, "/");

    const keys = normalized
      .split("/")
      .map((part) => part.replace(/[^a-z. ]/g, " ").trim())
      .flatMap((part) => part.split(/\s+/))
      .map((part) => part.replace(/\.$/, ""))
      .filter(Boolean)
      .map((part) => {
        if (part === "inter" || part === "int") return "interj";
        return part;
      })
      .filter((part) => groupLabels[part]);

    return [...new Set(keys)];
  }

  const displayGroup = (key) => groupLabels[key] ?? key;

  function directionForCard(entry, index) {
    if (cardMode !== "mixed") return cardMode;
    return (entry.id + index) % 2 === 0 ? "gr-en" : "en-gr";
  }

  function directionLabel(direction) {
    return direction === "en-gr" ? "English to Greek" : "Greek to English";
  }

  function setCardMode(value) {
    cardMode = value;
    cardFlipped = false;
    commitUrl();
  }

  function cycleCardMode() {
    const index = cardModes.findIndex((mode) => mode.value === cardMode);
    setCardMode(cardModes[(index + 1) % cardModes.length].value);
  }

  function getSenses(entry) {
    if (Array.isArray(entry.english_senses) && entry.english_senses.length) {
      return entry.english_senses;
    }
    return entry.english ? entry.english.split(/\s*;\s*/).filter(Boolean) : [];
  }

  function getAudioUrl(path) {
    if (!path) return "";
    const bucket = "didibros-6d3ed.firebasestorage.app";
    return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
  }

  function imageSrc(image) {
    return image?.url || image?.thumbnail || "";
  }

  function prepareData(payload) {
    const entries = payload.entries.map((entry) => {
      const senses = getSenses(entry);
      return {
        ...entry,
        theme: Number(entry.theme_id) === TOP_5000_ID ? "Top 5000" : entry.theme,
        category: cleanType(entry.category),
        groupKeys: groupKeysFrom(entry.subsection),
        english_senses: senses,
      };
    });

    const themes = payload.themes.map((theme) => {
      const themeEntries = entries.filter((entry) => entry.theme_id === theme.id);
      return {
        ...theme,
        title: cleanLessonTitle(theme),
        entry_count: themeEntries.length,
        translated_count: themeEntries.filter((entry) => entry.english).length,
        audio_count: themeEntries.filter((entry) => entry.audio_available).length,
      };
    });

    return { themes, entries };
  }

  async function loadData() {
    try {
      const themesSnapshot = await getDocs(collection(db, "themes"));
      const entriesSnapshot = await getDocs(collection(db, "entries"));
      
      const themes = themesSnapshot.docs.map(d => d.data());
      const rawEntries = entriesSnapshot.docs.map(d => d.data());
      
      const payload = { themes, entries: rawEntries };
      data = prepareData(payload);
      loadStateFromUrl();
    } catch (error) {
      console.error("Critical loading error:", error);
      loadError = `Could not load from Firestore: ${error.message}`;
    }
  }

  function matchesSearch(entry) {
    if (!search) return true;
    const haystack = normalise(
      [
        entry.term,
        entry.lemma,
        entry.article,
        entry.english,
        getSenses(entry).join(" "),
        entry.dictionary_headword,
        entry.top5000_definition,
        entry.theme,
        entry.category,
        entry.subsection,
      ].join(" "),
    );
    return haystack.includes(normalise(search));
  }

  function lessonProgress(lesson) {
    if (!lesson?.entry_count) return 0;
    return Math.round((lesson.translated_count / lesson.entry_count) * 100);
  }

  function lessonUrl(id) {
    return `/lesson/${id}`;
  }

  function buildUrl() {
    const params = new URLSearchParams();
    if (selectedType !== "all") params.set("type", selectedType);
    if (selectedGroup !== "all") params.set("group", selectedGroup);
    if (search) params.set("q", search);
    if (!translatedOnly) params.set("all", "1");
    if (cardMode !== "gr-en") params.set("dir", cardMode);
    if (cardsOpen) params.set("cards", "1");
    if (!showImages) params.set("noimg", "1");
    if (cardIndex > 0 && view === "study") params.set("card", cardIndex + 1);
    
    let base = "/lessons";
    if (view === "study" && selectedLessonId) base = lessonUrl(selectedLessonId);
    
    return params.toString() ? `${base}?${params.toString()}` : base;
  }

  function commitUrl(push = false) {
    const nextUrl = buildUrl();
    if (push) {
      window.history.pushState(null, "", nextUrl);
    } else {
      window.history.replaceState(null, "", nextUrl);
    }
  }

  function openLesson(id, push = true) {
    selectedLessonId = id;
    view = "study";
    selectedType = "all";
    selectedGroup = "all";
    resetCards();
    commitUrl(push);
  }

  function showLessons(push = true) {
    view = "lessons";
    selectedLessonId = null;
    selectedType = "all";
    selectedGroup = "all";
    cardIndex = 0;
    cardFlipped = false;
    commitUrl(push);
  }

  function setFilter(filter) {
    if (!filter) {
      selectedType = "all";
      selectedGroup = "all";
    } else if (filter.kind === 'type') {
      selectedType = filter.id;
      selectedGroup = "all";
    } else {
      selectedGroup = filter.id;
      selectedType = "all";
    }
    resetCards();
    commitUrl();
  }

  function resetCards() {
    cardIndex = 0;
    cardFlipped = false;
    deckOrderIds = null;
    audioLoadingId = null;
    if (currentAudio) currentAudio.pause();
    resetDrag();
  }

  function resetDrag() {
    dragStart = null;
    dragX = 0;
    dragY = 0;
    dragTransition = false;
  }

  function focusStudyCard() {
    queueMicrotask(() => studyCardEl?.focus({ preventScroll: true }));
  }

  function shuffleDeck() {
    const shuffled = [...deck];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    deckOrderIds = shuffled.map((entry) => entry.id);
    cardIndex = 0;
    cardFlipped = false;
  }

  function moveCard(delta) {
    if (!deck.length) return;
    if (currentAudio) currentAudio.pause();
    cardIndex = (cardIndex + delta + deck.length) % deck.length;
    cardFlipped = false;
    resetDrag();
    commitUrl();
    focusStudyCard();
  }

  async function playAudio(entry) {
    if (!entry?.audio_path) return;
    if (currentAudio) currentAudio.pause();
    const audio = new Audio(getAudioUrl(entry.audio_path));
    currentAudio = audio;
    audioLoadingId = entry.id;
    audio.addEventListener("ended", () => {
      if (currentAudio === audio) currentAudio = null;
    });
    try {
      await audio.play();
    } catch {
      // Ignore browser playback interruptions; the button simply returns to idle.
    } finally {
      if (currentAudio === audio) audioLoadingId = null;
    }
  }

  function loadStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const path = window.location.pathname;
    
    const lessonFromPath = path.match(/^\/lesson\/(\d+)/);
    const lesson = Number(lessonFromPath?.[1] ?? params.get("lesson"));
    if (lesson && data.themes.some((theme) => theme.id === lesson)) {
      selectedLessonId = lesson;
      view = "study";
    } else {
      selectedLessonId = null;
      view = "lessons";
    }

    selectedType = params.get("type") || "all";
    selectedGroup = params.get("group") || "all";
    search = params.get("q") || "";
    cardMode = cardModes.some((mode) => mode.value === params.get("dir")) ? params.get("dir") : "gr-en";
    translatedOnly = !params.has("all");
    cardsOpen = params.has("cards");
    showImages = !params.has("noimg");
    
    const requestedCard = Number(params.get("card"));
    if (requestedCard > 0) cardIndex = requestedCard - 1;
  }

  function openEdit(entry) {
    editingEntry = JSON.parse(JSON.stringify(entry));
    pexelsSearchQuery = entry.english_senses?.[0] || entry.english || entry.lemma;
    pexelsSearchResults = [];
  }

  function addSense() {
    if (!editingEntry) return;
    editingEntry.english_senses = [...editingEntry.english_senses, ""];
  }

  function removeSense(index) {
    if (!editingEntry) return;
    editingEntry.english_senses = editingEntry.english_senses.filter((_, i) => i !== index);
  }

  function closeEdit() {
    editingEntry = null;
  }

  async function saveEdit() {
    if (!editingEntry) return;
    try {
      const entryRef = doc(db, "entries", String(editingEntry.id));
      await updateDoc(entryRef, {
        english_senses: editingEntry.english_senses || [],
        image: editingEntry.image || null
      });
      data.entries = data.entries.map(e => e.id === editingEntry.id ? { ...editingEntry } : e);
      data = { ...data }; // Trigger reactivity
      closeEdit();
    } catch (err) {
      console.error("Save failed:", err);
      alert("Error saving: " + err.message);
    }
  }

  async function searchPexelsInApp() {
    if (!pexelsSearchQuery) return;
    pexelsSearching = true;
    try {
      const apiKey = import.meta.env.VITE_PEXELS_API_KEY;
      const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(pexelsSearchQuery)}&per_page=12`, {
        headers: { Authorization: apiKey }
      });
      const json = await res.json();
      pexelsSearchResults = json.photos || [];
    } catch (err) {
      console.error("Pexels search failed:", err);
    } finally {
      pexelsSearching = false;
    }
  }

  async function handleImageUpload(event) {
    const file = event.target.files?.[0];
    if (!file || !editingEntry) return;
    try {
      const storageRef = ref(storage, `images/${editingEntry.id}_${Date.now()}_${file.name}`);
      const snapshot = await uploadBytes(storageRef, file);
      const url = await getDownloadURL(snapshot.ref);
      editingEntry.image = {
        url,
        thumbnail: url,
        title: editingEntry.lemma,
        creator: "User Upload",
        source: "custom"
      };
    } catch (err) {
      console.error("Upload failed:", err);
      alert("Upload failed: " + err.message);
    }
  }

  function selectPexelsPhoto(photo) {
    if (!editingEntry) return;
    editingEntry.image = {
      url: photo.src.original,
      thumbnail: photo.src.medium,
      title: editingEntry.lemma,
      creator: photo.photographer,
      landing_url: photo.url,
      source: "pexels",
      pexels_id: photo.id,
      position: "center"
    };
  }

  function handleKeydown(event) {
    const isTyping = ["INPUT", "SELECT", "TEXTAREA"].includes(event.target?.tagName);
    if (isTyping) return;
    const key = event.key;

    if (key === "?" || key.toLowerCase() === "h") {
      event.preventDefault();
      shortcutsOpen = true;
      return;
    }

    if (key === "Escape" && shortcutsOpen) {
      shortcutsOpen = false;
      return;
    }

    if (shortcutsOpen) return;

    if (view !== "study" || !cardsOpen) return;

    if (key.toLowerCase() === "a") {
      event.preventDefault();
      playAudio(currentCard);
      return;
    }

    if (key.toLowerCase() === "s" && event.shiftKey) {
      event.preventDefault();
      shuffleDeck();
      return;
    }

    if (key.toLowerCase() === "l") {
      event.preventDefault();
      showLessons(true);
      return;
    }

    if (key.toLowerCase() === "m") {
      event.preventDefault();
      cycleCardMode();
      return;
    }

    if (["ArrowLeft", "Left", "PageUp"].includes(key)) {
      event.preventDefault();
      moveCard(-1);
      return;
    }

    if (["ArrowRight", "Right", "PageDown"].includes(key)) {
      event.preventDefault();
      moveCard(1);
      return;
    }

    if (key === " " || key === "Spacebar" || key === "Enter") {
      event.preventDefault();
      flipCard();
    }
  }

  function flipCard() {
    if (!currentCard) return;
    cardFlipped = !cardFlipped;
    commitUrl();
    focusStudyCard();
  }

  function handleCardPointerDown(event) {
    if (!currentCard || event.button !== 0 || event.target.closest("button")) return;
    dragTransition = false;
    dragStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    dragX = 0;
    dragY = 0;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleCardPointerMove(event) {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    dragX = event.clientX - dragStart.x;
    dragY = event.clientY - dragStart.y;
  }

  function handleCardPointerUp(event) {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    const absX = Math.abs(dragX);
    const absY = Math.abs(dragY);
    const swiped = absX > 90 && absX > absY * 1.15;
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    if (swiped) {
      suppressNextClick = true;
      dragTransition = true;
      dragX = dragX > 0 ? 360 : -360;
      dragY = Math.max(-80, Math.min(80, dragY));
      const delta = dragX < 0 ? 1 : -1;
      setTimeout(() => moveCard(delta), 120);
      return;
    }

    resetDrag();
    flipCard();
  }

  function handleCardPointerCancel() {
    dragTransition = true;
    dragX = 0;
    dragY = 0;
    dragStart = null;
    setTimeout(() => {
      dragTransition = false;
    }, 140);
  }

  $: lessons = data?.themes ?? [];
  $: selectedLesson = lessons.find((lesson) => lesson.id === selectedLessonId);
  $: lessonEntries = data?.entries.filter((entry) => entry.theme_id === selectedLessonId) ?? [];
  $: showGroupFilter = selectedLessonId === TOP_5000_ID;
  $: typeCandidateEntries = lessonEntries.filter((entry) => {
    if (selectedGroup !== "all" && !entry.groupKeys.includes(selectedGroup)) return false;
    if (translatedOnly && !entry.english) return false;
    return matchesSearch(entry);
  });
  $: lessonTypes = [...new Set(lessonEntries.map((entry) => entry.category))]
    .filter(Boolean)
    .map(t => ({ id: t, label: displayType(t), kind: 'type' }));
    
  $: groupOptions = [...new Set(lessonEntries.flatMap((entry) => entry.groupKeys))]
    .filter(Boolean)
    .map(g => ({ id: g, label: displayGroup(g), kind: 'group' }));

  $: allFilters = [...lessonTypes, ...groupOptions]
    .sort((a, b) => a.label.localeCompare(b.label))
    .filter((v, i, a) => a.findIndex(t => t.label === v.label) === i);
  $: if (data && view === "study" && selectedType !== "all" && !lessonTypes.some(t => t.id === selectedType)) {
    selectedType = "all";
    resetCards();
    queueMicrotask(() => commitUrl());
  }
  $: if (data && view === "study" && selectedGroup !== "all" && !groupOptions.some(t => t.id === selectedGroup)) {
    selectedGroup = "all";
    resetCards();
    queueMicrotask(() => commitUrl());
  }
  $: filteredEntries = lessonEntries.filter((entry) => {
    // If we've selected a specific part-of-speech (either via category or tag)
    if (selectedType !== "all" || selectedGroup !== "all") {
      const activeFilterId = selectedType !== "all" ? selectedType : selectedGroup;
      const activeFilterLabel = (selectedType !== "all" ? displayType(selectedType) : displayGroup(selectedGroup)).toLowerCase();
      
      // 1. Check category match
      const entryCategoryLabel = displayType(entry.category).toLowerCase();
      const matchesCategory = entryCategoryLabel === activeFilterLabel || entryCategoryLabel.startsWith(activeFilterLabel) || activeFilterLabel.startsWith(entryCategoryLabel);
      
      // 2. Check tag match
      const hasMatchingTag = entry.groupKeys.some(g => {
        const tagLabel = displayGroup(g).toLowerCase();
        return tagLabel === activeFilterLabel || tagLabel.startsWith(activeFilterLabel) || activeFilterLabel.startsWith(tagLabel);
      });
      
      if (!matchesCategory && !hasMatchingTag) return false;
    }
    
    if (translatedOnly && !entry.english) return false;
    return matchesSearch(entry);
  });
  $: deckBase = translatedOnly ? filteredEntries.filter((entry) => entry.english) : filteredEntries;
  $: deck = deckOrderIds
    ? [
        ...deckOrderIds.map((id) => deckBase.find((entry) => entry.id === id)).filter(Boolean),
        ...deckBase.filter((entry) => !deckOrderIds.includes(entry.id)),
      ]
    : deckBase;
  $: if (cardIndex >= deck.length) cardIndex = 0;
  $: currentCard = deck[cardIndex];
  $: currentDirection = currentCard ? directionForCard(currentCard, cardIndex) : "gr-en";
  $: visibleEntries = filteredEntries.slice(0, cardsOpen ? STUDY_ENTRY_RENDER_LIMIT : ENTRY_RENDER_LIMIT);
  $: cardTransform = `translate(${dragX}px, ${dragY}px) rotate(${dragX / 28}deg)`;

  loadData();
</script>

<svelte:window on:keydown={handleKeydown} on:popstate={loadStateFromUrl} />

<main class="min-h-screen bg-paper text-ink">
  <header class="sticky top-0 z-20 border-b border-line bg-white/92 backdrop-blur">
    <div class="mx-auto flex h-12 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
      <a
        href="/lessons"
        class="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold text-ink hover:bg-paper"
        on:click|preventDefault={() => showLessons(true)}
      >
        <BookOpen size={17} />
        Greek
      </a>
      <div class="flex min-w-0 items-center gap-2">
        {#if view === "study"}
          <button
            class="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-bold transition
                   {showImages ? 'text-green bg-green/10' : 'text-muted hover:bg-paper'}"
            on:click={() => { showImages = !showImages; commitUrl(); }}
          >
            <ImageIcon size={14} />
            <span>{showImages ? 'Images On' : 'Images Off'}</span>
          </button>
        {/if}
        {#if view === "study" && selectedLesson}
          <div class="min-w-0 truncate text-sm font-semibold text-muted">{selectedLesson.title}</div>
        {/if}
        <button
          class="icon-button h-8 w-8"
          type="button"
          title="Keyboard shortcuts"
          aria-label="Keyboard shortcuts"
          on:click={() => (shortcutsOpen = true)}
        >
          <Keyboard size={15} />
        </button>
      </div>
    </div>
  </header>

  {#if loadError}
    <section class="mx-auto max-w-3xl px-4 py-16">
      <div class="rounded-md border border-line bg-panel p-5 text-sm text-clay">{loadError}</div>
    </section>
  {:else if !data}
    <section class="mx-auto max-w-3xl px-4 py-16 text-sm text-muted">Loading vocabulary...</section>
  {:else if view === "lessons"}
    <section class="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 class="text-2xl font-bold tracking-normal text-ink sm:text-3xl">Choose your next lesson</h1>
          <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Pick a set, do a quick round, and keep the words moving.
          </p>
        </div>
        <label class="relative block w-full sm:w-80">
          <Search class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={17} />
          <input
            class="control pl-9"
            type="search"
            bind:value={search}
            placeholder="Find a lesson..."
            on:input={() => commitUrl()}
          />
        </label>
      </div>

      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {#each lessons.filter((lesson) => normalise(lesson.title).includes(normalise(search))) as lesson}
          <a
            href={lessonUrl(lesson.id)}
            class="group min-h-40 rounded-md border border-line bg-panel p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-green hover:shadow-md"
            on:click|preventDefault={() => openLesson(lesson.id, true)}
          >
            <div class="mb-3 flex items-start justify-between gap-3">
              <div class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-paper text-sm font-black text-green">
                {lesson.id}
              </div>
              <h2 class="min-w-0 flex-1 text-base font-bold leading-snug text-ink">{lesson.title}</h2>
              <ChevronRight class="mt-2 shrink-0 text-muted transition group-hover:text-green" size={18} />
            </div>
            <div class="mb-3 h-2 overflow-hidden rounded-full bg-paper">
              <div class="h-full rounded-full bg-green" style={`width: ${lessonProgress(lesson)}%`}></div>
            </div>
            <div class="flex flex-wrap gap-2">
              <span class="chip">{lesson.entry_count.toLocaleString()} words</span>
              <span class="chip">{lesson.translated_count.toLocaleString()} meanings</span>
              {#if lesson.audio_count}
                <span class="chip">{lesson.audio_count.toLocaleString()} audio</span>
              {/if}
            </div>
            <div class="mt-4 inline-flex items-center gap-1.5 rounded-md bg-green px-3 py-1.5 text-sm font-bold text-white">
              Start
              <ChevronRight size={15} />
            </div>
          </a>
        {/each}
      </div>
    </section>
  {:else}
    <section class="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[260px_1fr]">
      <aside class="min-w-0">
        <div class="sticky top-16 grid gap-4">
          <a
            href="/lessons"
            class="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm font-semibold text-ink hover:border-green hover:text-green"
            on:click|preventDefault={() => showLessons(true)}
          >
            <Home size={16} />
            Lessons
          </a>

          <section class="rounded-md border border-line bg-panel p-3 shadow-sm">
            <h2 class="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
              <Layers3 size={16} />
              Classification
            </h2>
            <div class="flex flex-wrap gap-1">
              <button
                class="rounded-md px-3 py-1.5 text-xs font-bold {selectedType === 'all' && selectedGroup === 'all' ? 'bg-green text-white shadow-sm' : 'bg-paper text-muted border border-line hover:border-ink hover:text-ink transition'}"
                type="button"
                on:click={() => setFilter(null)}
              >
                All
              </button>
              {#each allFilters as filter}
                <button
                  class="rounded-md px-3 py-1.5 text-xs font-bold transition-all
                         {(selectedType === filter.id || selectedGroup === filter.id) ? 'bg-green text-white shadow-md' : 'bg-paper text-muted border border-line hover:border-ink hover:text-ink'}"
                  type="button"
                  on:click={() => setFilter(filter)}
                >
                  {filter.label}
                </button>
              {/each}
            </div>
          </section>

          <label class="flex items-center gap-2 rounded-md border border-line bg-panel p-3 text-sm font-semibold text-ink shadow-sm">
            <input
              class="h-4 w-4 accent-green"
              type="checkbox"
              bind:checked={translatedOnly}
              on:change={() => {
                resetCards();
                commitUrl();
              }}
            />
            With meanings only
          </label>
        </div>
      </aside>

      <section class="min-w-0">
        <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div class="min-w-0">
            <h1 class="truncate text-2xl font-bold tracking-normal sm:text-3xl">{selectedLesson?.title}</h1>
            <p class="mt-1 text-sm text-muted">Practice round · {filteredEntries.length.toLocaleString()} words ready</p>
          </div>
          <label class="relative block w-full sm:w-80">
            <Search class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={17} />
            <input
              class="control pl-9"
              type="search"
              bind:value={search}
              placeholder="Greek or English..."
              on:input={() => {
                resetCards();
                commitUrl();
              }}
            />
          </label>
        </div>

        <section class="mb-4 rounded-md border border-line bg-panel p-3 shadow-sm">
          <div class="mb-3 flex items-center justify-between gap-3">
            <div>
              <div class="text-sm font-bold text-ink">Study cards</div>
              <div class="text-xs font-semibold text-muted">{deck.length.toLocaleString()} in this round</div>
            </div>
            <div class="flex gap-2">
              <button class="icon-button" type="button" title="Shuffle cards" aria-label="Shuffle cards" disabled={!deck.length} on:click={shuffleDeck}>
                <Shuffle size={16} />
              </button>
              <button class="icon-button" type="button" title="Previous card" aria-label="Previous card" disabled={!deck.length} on:click={() => moveCard(-1)}>
                <ChevronLeft size={17} />
              </button>
              <button class="icon-button" type="button" title="Flip card" aria-label="Flip card" disabled={!deck.length} on:click={flipCard}>
                <RotateCcw size={16} />
              </button>
              <button class="icon-button" type="button" title="Next card" aria-label="Next card" disabled={!deck.length} on:click={() => moveCard(1)}>
                <ChevronRight size={17} />
              </button>
            </div>
          </div>

          <div class="mb-3 flex items-center gap-1 rounded-full bg-subtle p-1 border border-line w-fit">
            {#each cardModes as mode}
              <button
                class="inline-flex h-8 items-center justify-center rounded-full px-4 text-xs font-bold transition-all
                       {cardMode === mode.value ? 'bg-green text-white shadow-md scale-105' : 'text-muted hover:text-ink hover:bg-white'}"
                type="button"
                on:click={() => setCardMode(mode.value)}
              >
                {mode.short || mode.label}
              </button>
            {/each}
          </div>

          <div
            bind:this={studyCardEl}
            class="grid min-h-72 w-full touch-pan-y select-none place-items-center rounded-md border p-5 text-center transition {dragTransition ? 'duration-150 ease-out' : ''} {cardFlipped ? 'border-gold/60 bg-[#fff9ec] shadow-sm' : 'border-line bg-paper hover:border-green'} {currentCard ? 'cursor-pointer' : 'opacity-60'}"
            style={`transform: ${cardTransform};`}
            role="button"
            tabindex={currentCard ? 0 : -1}
            aria-disabled={!currentCard}
            on:pointerdown={handleCardPointerDown}
            on:pointermove={handleCardPointerMove}
            on:pointerup={handleCardPointerUp}
            on:pointercancel={handleCardPointerCancel}
            on:click={(event) => {
              if (suppressNextClick) {
                event.preventDefault();
                suppressNextClick = false;
              }
            }}
            on:keydown={(event) => {
              if (!currentCard || (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar")) return;
              event.preventDefault();
              flipCard();
            }}
          >
            {#if currentCard}
              <div class="group relative grid max-w-3xl gap-4">
                <button
                  class="absolute -top-4 -right-4 rounded-full bg-paper p-2 text-muted shadow-sm border border-line hover:text-ink hover:scale-110 transition md:opacity-0 group-hover:opacity-100"
                  title="Edit word"
                  on:click|stopPropagation={() => openEdit(currentCard)}
                >
                  <Edit2 size={16} />
                </button>
                <div class="mx-auto w-full max-w-md">
                  <div class="mb-2 flex items-center justify-between text-xs font-bold text-muted">
                    <span class={cardFlipped ? "rounded-md bg-gold/15 px-2 py-1 text-gold" : ""}>
                      {cardFlipped ? "Answer" : directionLabel(currentDirection)}
                    </span>
                    <span>{cardIndex + 1} / {deck.length.toLocaleString()}</span>
                  </div>
                  <div class="h-2 overflow-hidden rounded-full bg-white">
                    <div class="h-full rounded-full bg-green" style={`width: ${((cardIndex + 1) / deck.length) * 100}%`}></div>
                  </div>
                </div>
                {#if cardFlipped && currentCard.image && showImages}
                  <figure class="mx-auto grid max-w-xs gap-1.5">
                    <img
                      class="aspect-[16/10] w-full rounded-md border border-line object-cover shadow-sm transition-all"
                      style={`object-position: ${currentCard.image.position || 'center'};`}
                      src={imageSrc(currentCard.image)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                    <figcaption class="line-clamp-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                      Source: {currentCard.image.source}
                    </figcaption>
                  </figure>
                {/if}
                {#if currentDirection === "gr-en"}
                  {#if cardFlipped}
                    <ol class="mx-auto max-w-2xl list-decimal space-y-2 pl-6 text-left text-xl font-semibold leading-snug text-ink sm:text-2xl">
                      {#each getSenses(currentCard) as sense}
                        <li>{sense}</li>
                      {/each}
                    </ol>
                    <span class="text-sm font-semibold text-muted">{currentCard.lemma}</span>
                  {:else}
                    <strong class="break-words text-4xl font-bold leading-tight text-ink sm:text-5xl">{currentCard.lemma}</strong>
                    <span class="text-sm font-semibold text-muted">Tap to reveal meaning</span>
                  {/if}
                {:else}
                  {#if cardFlipped}
                    <strong class="break-words text-4xl font-bold leading-tight text-ink sm:text-5xl">{currentCard.lemma}</strong>
                    <span class="text-sm font-semibold text-muted">Greek answer</span>
                  {:else}
                    <ol class="mx-auto max-w-2xl list-decimal space-y-2 pl-6 text-left text-xl font-semibold leading-snug text-ink sm:text-2xl">
                      {#each getSenses(currentCard) as sense}
                        <li>{sense}</li>
                      {/each}
                    </ol>
                    <span class="text-sm font-semibold text-muted">Tap to reveal Greek</span>
                  {/if}
                {/if}
                {#if currentCard.audio_path && (currentDirection === "gr-en" || cardFlipped)}
                  <button
                    class="mx-auto inline-grid h-10 w-10 place-items-center rounded-md border border-line bg-white text-green shadow-sm hover:border-green"
                    type="button"
                    title="Play pronunciation"
                    aria-label="Play pronunciation"
                    on:click|stopPropagation={() => playAudio(currentCard)}
                  >
                    {#if audioLoadingId === currentCard.id}
                      <LoaderCircle class="animate-spin" size={18} />
                    {:else}
                      <Volume2 size={18} />
                    {/if}
                  </button>
                {/if}
              </div>
            {:else}
              <span class="text-sm text-muted">No study cards match these filters.</span>
            {/if}
          </div>
        </section>

        <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {#each visibleEntries as entry}
            <article class="group relative min-h-32 rounded-md border border-line bg-panel p-3 shadow-sm hover:border-green transition">
              <button
                class="absolute right-2 top-2 z-10 rounded-full bg-paper p-1.5 text-muted shadow-sm border border-line hover:text-ink opacity-0 group-hover:opacity-100 transition"
                title="Edit word"
                on:click={() => openEdit(entry)}
              >
                <Edit2 size={14} />
              </button>
              {#if entry.image && showImages}
                <img
                  class="mb-3 aspect-[16/9] w-full rounded-md border border-line object-cover transition-all duration-300 hover:aspect-square hover:max-h-64 cursor-zoom-in"
                  style={`object-position: ${entry.image.position || 'center'};`}
                  src={imageSrc(entry.image)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              {/if}
              <div class="mb-2 flex items-start justify-between gap-3">
                <div class="break-words text-lg font-bold leading-snug text-ink">{entry.lemma}</div>
                {#if entry.audio_path}
                  <button
                    class="icon-button h-8 w-8"
                    type="button"
                    title="Play pronunciation"
                    aria-label="Play pronunciation"
                    on:click={() => playAudio(entry)}
                  >
                    {#if audioLoadingId === entry.id}
                      <LoaderCircle class="animate-spin" size={15} />
                    {:else}
                      <Volume2 size={15} />
                    {/if}
                  </button>
                {/if}
              </div>
              {#if getSenses(entry).length}
                <ol class="line-clamp-4 list-decimal pl-5 text-sm leading-5 text-muted">
                  {#each getSenses(entry).slice(0, 4) as sense}
                    <li>{sense}</li>
                  {/each}
                </ol>
              {:else}
                <p class="text-sm italic text-clay">Meaning not available yet</p>
              {/if}
              <div class="mt-3 flex flex-wrap gap-1.5">
                {#if entry.article}
                  <span class="chip">{entry.article}</span>
                {/if}
                <span class="chip">{displayType(entry.category)}</span>
                {#if showGroupFilter}
                  {#each entry.groupKeys as group}
                    <span class="chip">{displayGroup(group)}</span>
                  {/each}
                {/if}
              </div>
            </article>
          {/each}
        </div>

        {#if filteredEntries.length > visibleEntries.length}
          <div class="mt-3 rounded-md border border-dashed border-line bg-white/70 p-4 text-sm text-muted">
            Showing {visibleEntries.length.toLocaleString()} of {filteredEntries.length.toLocaleString()} words. Search or filter to narrow the lesson.
          </div>
        {/if}
      </section>
    </section>
  {/if}

  {#if shortcutsOpen}
    <div
      class="fixed inset-0 z-40 grid place-items-center bg-ink/25 p-4"
      role="presentation"
      on:click={(event) => {
        if (event.currentTarget === event.target) shortcutsOpen = false;
      }}
    >
      <div
        class="w-full max-w-md rounded-md border border-line bg-panel p-4 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-title"
      >
        <div class="mb-4 flex items-center justify-between gap-3">
          <h2 id="shortcut-title" class="text-base font-bold text-ink">Keyboard shortcuts</h2>
          <button class="icon-button h-8 w-8" type="button" aria-label="Close" on:click={() => (shortcutsOpen = false)}>
            <X size={16} />
          </button>
        </div>
        <dl class="grid gap-2 text-sm">
          <div class="grid grid-cols-[96px_1fr] items-center gap-3">
            <dt class="rounded-md border border-line bg-paper px-2 py-1.5 text-center font-bold text-green">?</dt>
            <dd class="m-0 text-muted">Show shortcuts</dd>
          </div>
          <div class="grid grid-cols-[96px_1fr] items-center gap-3">
            <dt class="rounded-md border border-line bg-paper px-2 py-1.5 text-center font-bold text-green">Space</dt>
            <dd class="m-0 text-muted">Flip card</dd>
          </div>
          <div class="grid grid-cols-[96px_1fr] items-center gap-3">
            <dt class="rounded-md border border-line bg-paper px-2 py-1.5 text-center font-bold text-green">← / →</dt>
            <dd class="m-0 text-muted">Previous or next card</dd>
          </div>
          <div class="grid grid-cols-[96px_1fr] items-center gap-3">
            <dt class="rounded-md border border-line bg-paper px-2 py-1.5 text-center font-bold text-green">A</dt>
            <dd class="m-0 text-muted">Play pronunciation</dd>
          </div>
          <div class="grid grid-cols-[96px_1fr] items-center gap-3">
            <dt class="rounded-md border border-line bg-paper px-2 py-1.5 text-center font-bold text-green">Shift S</dt>
            <dd class="m-0 text-muted">Shuffle cards</dd>
          </div>
          <div class="grid grid-cols-[96px_1fr] items-center gap-3">
            <dt class="rounded-md border border-line bg-paper px-2 py-1.5 text-center font-bold text-green">M</dt>
            <dd class="m-0 text-muted">Change card direction</dd>
          </div>
          <div class="grid grid-cols-[96px_1fr] items-center gap-3">
            <dt class="rounded-md border border-line bg-paper px-2 py-1.5 text-center font-bold text-green">L</dt>
            <dd class="m-0 text-muted">Back to lessons</dd>
          </div>
        </dl>
      </div>
    </div>
  {/if}
  {#if editingEntry}
    <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div class="absolute inset-0 bg-ink/40 backdrop-blur-sm" on:click={closeEdit}></div>
      <div class="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-paper shadow-2xl flex flex-col border border-line">
        <div class="flex items-center justify-between border-b border-line p-4">
          <h2 class="text-xl font-bold text-ink">Edit Word</h2>
          <button on:click={closeEdit} class="rounded-lg p-2 text-muted hover:bg-subtle transition">
            <X class="h-5 w-5" />
          </button>
        </div>
        
        <div class="flex-1 overflow-y-auto p-6 space-y-8">
          <!-- Definitions -->
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold uppercase tracking-wider text-muted">Definitions</h3>
              <button
                on:click={addSense}
                class="flex items-center gap-1.5 rounded-lg bg-green/10 px-3 py-1.5 text-xs font-bold text-green hover:bg-green/20 transition"
              >
                <Plus class="h-3.5 w-3.5" />
                <span>Add Meaning</span>
              </button>
            </div>
            
            <div class="space-y-3">
              <div class="space-y-1.5">
                <label class="text-xs font-bold text-muted ml-1">Lemma (Greek)</label>
                <input
                  type="text"
                  bind:value={editingEntry.lemma}
                  class="w-full rounded-xl border border-line bg-subtle px-4 py-2.5 font-bold text-ink focus:border-green focus:ring-4 focus:ring-green/10 outline-none transition"
                />
              </div>

              <div class="space-y-2">
                <label class="text-xs font-bold text-muted ml-1">English Meanings</label>
                {#each editingEntry.english_senses as sense, i}
                  <div class="flex items-center gap-2 group/sense">
                    <div class="flex-1 relative">
                      <input
                        type="text"
                        bind:value={editingEntry.english_senses[i]}
                        class="w-full rounded-xl border border-line bg-subtle px-4 py-2 text-sm text-ink focus:border-green focus:ring-4 focus:ring-green/10 outline-none transition"
                        placeholder={`Sense #${i + 1}`}
                      />
                    </div>
                    <button
                      on:click={() => removeSense(i)}
                      class="p-2 text-muted hover:text-red-500 transition opacity-0 group-hover/sense:opacity-100"
                    >
                      <Trash2 class="h-4 w-4" />
                    </button>
                  </div>
                {/each}
                {#if editingEntry.english_senses.length === 0}
                  <p class="text-xs text-muted italic ml-1">No meanings defined yet.</p>
                {/if}
              </div>
            </div>
          </div>

          <!-- Image Section -->
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold uppercase tracking-wider text-muted">Image</h3>
              <label class="flex items-center gap-2 cursor-pointer rounded-lg bg-green/10 px-3 py-1.5 text-xs font-bold text-green hover:bg-green/20 transition">
                <Upload class="h-3.5 w-3.5" />
                <span>Upload Custom</span>
                <input type="file" class="hidden" accept="image/*" on:change={handleImageUpload} />
              </label>
            </div>
            
            <div class="flex gap-4 p-4 rounded-2xl bg-subtle border border-line">
              <div class="w-32 aspect-square rounded-xl overflow-hidden bg-paper border border-line shrink-0">
                {#if editingEntry.image}
                  <img src={editingEntry.image.thumbnail} alt="" class="w-full h-full object-cover" loading="lazy" decoding="async" />
                {:else}
                  <div class="w-full h-full flex items-center justify-center text-muted">
                    <ImageIcon class="h-8 w-8 opacity-20" />
                  </div>
                {/if}
              </div>
              <div class="flex-1 min-w-0 flex flex-col justify-center">
                <div class="flex items-center gap-3 mb-4">
                  <input
                    type="text"
                    bind:value={pexelsSearchQuery}
                    placeholder="Search Pexels..."
                    class="flex-1 min-w-0 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm outline-none focus:border-green transition"
                    on:keydown={(e) => e.key === 'Enter' && searchPexelsInApp()}
                  />
                  <button
                    on:click={searchPexelsInApp}
                    disabled={pexelsSearching}
                    class="rounded-lg bg-green px-4 py-1.5 text-sm font-bold text-white hover:bg-green/90 transition disabled:opacity-50"
                  >
                    {pexelsSearching ? '...' : 'Search'}
                  </button>
                </div>

                {#if editingEntry.image}
                  <div class="mb-4">
                    <label class="text-[10px] font-bold text-muted uppercase tracking-wider mb-2 block">Crop Focus</label>
                    <div class="flex gap-2">
                      {#each ['top', 'center', 'bottom'] as pos}
                        <button
                          class="flex-1 py-1 rounded-md text-[10px] font-bold uppercase tracking-tight border transition
                                 {editingEntry.image.position === pos ? 'bg-ink text-white border-ink' : 'bg-paper text-muted border-line hover:border-ink'}"
                          on:click={() => editingEntry.image.position = pos}
                        >
                          {pos}
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}
                
                {#if pexelsSearchResults.length > 0}
                  <div class="grid grid-cols-4 gap-2 overflow-y-auto max-h-32">
                    {#each pexelsSearchResults as photo}
                      <button
                        on:click={() => selectPexelsPhoto(photo)}
                        class="aspect-square rounded-lg overflow-hidden border-2 transition
                               {editingEntry.image?.pexels_id === photo.id ? 'border-green scale-95 shadow-inner' : 'border-transparent hover:border-line'}"
                      >
                        <img src={photo.src.tiny} alt="" class="w-full h-full object-cover" loading="lazy" decoding="async" />
                      </button>
                    {/each}
                  </div>
                {:else if !pexelsSearching}
                  <p class="text-xs text-muted">Search for an image or upload your own.</p>
                {/if}
              </div>
            </div>
          </div>
        </div>

        <div class="border-t border-line p-4 flex justify-end gap-3 bg-subtle">
          <button on:click={closeEdit} class="px-6 py-2 rounded-xl text-sm font-bold text-muted hover:text-ink transition">
            Cancel
          </button>
          <button on:click={saveEdit} class="px-8 py-2 rounded-xl bg-ink text-white text-sm font-bold hover:bg-black transition">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  {/if}
</main>
