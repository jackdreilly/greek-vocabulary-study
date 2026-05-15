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
  } from "lucide-svelte";

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
  let cardIndex = 0;
  let cardFlipped = false;
  let cardMode = "gr-en";
  let deckOrderIds = null;
  let currentAudio = null;
  let audioLoadingId = null;
  let shortcutsOpen = false;

  const typeLabels = {
    "Ουσιαστικά": "Nouns",
    "Επίθετα": "Adjectives",
    "Ρήματα": "Verbs",
    "Εκφράσεις": "Phrases",
    "Top 5000": "Top 5000",
    SilentShuffle: "Top 5000",
  };

  const groupLabels = {
    art: "Article",
    part: "Particle",
    v: "Verb",
    n: "Noun",
    adj: "Adjective",
    adv: "Adverb",
    prep: "Preposition",
    pron: "Pronoun",
    conj: "Conjunction",
    interj: "Interjection",
    inter: "Interjection",
    int: "Interjection",
    det: "Determiner",
    num: "Number",
    coll: "Collective",
  };

  const cardModes = [
    { value: "gr-en", label: "Greek to English" },
    { value: "en-gr", label: "English to Greek" },
    { value: "mixed", label: "Mixed" },
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

  function prepareData(payload) {
    const entries = payload.entries.map((entry) => ({
      ...entry,
      theme: Number(entry.theme_id) === TOP_5000_ID ? "Top 5000" : entry.theme,
      category: cleanType(entry.category),
      groupKeys: groupKeysFrom(entry.subsection),
    }));

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
      const params = new URLSearchParams(window.location.search);
      const bucket = "didibros-6d3ed.firebasestorage.app";
      const prodDataUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/data%2Flexilogio.json?alt=media`;
      const response = await fetch(params.has("prod") ? prodDataUrl : "/data/lexilogio.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = prepareData(await response.json());
      loadStateFromUrl();
    } catch (error) {
      loadError = `Could not load the collection: ${error.message}`;
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
    if (cardsOpen && view === "study") params.set("cards", "1");
    if (cardIndex > 0 && view === "study") params.set("card", cardIndex + 1);
    const base = view === "study" && selectedLessonId ? lessonUrl(selectedLessonId) : "/lessons";
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

  function setType(value) {
    selectedType = value;
    resetCards();
    commitUrl();
  }

  function setGroup(value) {
    selectedGroup = value;
    resetCards();
    commitUrl();
  }

  function resetCards() {
    cardIndex = 0;
    cardFlipped = false;
    deckOrderIds = null;
    audioLoadingId = null;
    if (currentAudio) currentAudio.pause();
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
    commitUrl();
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
    const lessonFromPath = window.location.pathname.match(/^\/lesson\/(\d+)/);
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
    cardsOpen = params.has("cards") || view === "study";
    const requestedCard = Number(params.get("card"));
    if (requestedCard > 0) cardIndex = requestedCard - 1;
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
      cardFlipped = !cardFlipped;
      commitUrl();
    }
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
  $: lessonTypes = [...new Set(typeCandidateEntries.map((entry) => entry.category))]
    .filter(Boolean)
    .sort((a, b) => displayType(a).localeCompare(displayType(b)));
  $: groupOptions = [...new Set(lessonEntries.flatMap((entry) => entry.groupKeys))]
    .filter(Boolean)
    .sort((a, b) => displayGroup(a).localeCompare(displayGroup(b)));
  $: if (data && view === "study" && selectedType !== "all" && !lessonTypes.includes(selectedType)) {
    selectedType = "all";
    resetCards();
    queueMicrotask(() => commitUrl());
  }
  $: filteredEntries = lessonEntries.filter((entry) => {
    if (selectedType !== "all" && entry.category !== selectedType) return false;
    if (selectedGroup !== "all" && !entry.groupKeys.includes(selectedGroup)) return false;
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
              Type
            </h2>
            <div class="grid gap-1">
              <button
                class="rounded-md px-3 py-2 text-left text-sm font-semibold {selectedType === 'all' ? 'bg-green text-white' : 'text-muted hover:bg-paper hover:text-ink'}"
                type="button"
                on:click={() => setType("all")}
              >
                All types
              </button>
              {#each lessonTypes as type}
                <button
                  class="rounded-md px-3 py-2 text-left text-sm font-semibold {selectedType === type ? 'bg-green text-white' : 'text-muted hover:bg-paper hover:text-ink'}"
                  type="button"
                  on:click={() => setType(type)}
                >
                  {displayType(type)}
                </button>
              {/each}
            </div>
          </section>

          {#if showGroupFilter}
            <section class="rounded-md border border-line bg-panel p-3 shadow-sm">
              <h2 class="mb-3 text-sm font-bold text-ink">Group</h2>
              <select class="control" bind:value={selectedGroup} on:change={() => setGroup(selectedGroup)}>
                <option value="all">All groups</option>
                {#each groupOptions as group}
                  <option value={group}>{displayGroup(group)}</option>
                {/each}
              </select>
            </section>
          {/if}

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
              <button class="icon-button" type="button" title="Flip card" aria-label="Flip card" disabled={!deck.length} on:click={() => (cardFlipped = !cardFlipped)}>
                <RotateCcw size={16} />
              </button>
              <button class="icon-button" type="button" title="Next card" aria-label="Next card" disabled={!deck.length} on:click={() => moveCard(1)}>
                <ChevronRight size={17} />
              </button>
            </div>
          </div>

          <div class="mb-3 grid gap-1 rounded-md bg-paper p-1 sm:inline-grid sm:grid-cols-3">
            {#each cardModes as mode}
              <button
                class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-bold transition {cardMode === mode.value ? 'bg-white text-green shadow-sm' : 'text-muted hover:text-ink'}"
                type="button"
                on:click={() => setCardMode(mode.value)}
              >
                <Languages size={15} />
                {mode.label}
              </button>
            {/each}
          </div>

          <div
            class="grid min-h-72 w-full place-items-center rounded-md border p-5 text-center transition {cardFlipped ? 'border-gold/60 bg-[#fff9ec] shadow-sm' : 'border-line bg-paper hover:border-green'} {currentCard ? 'cursor-pointer' : 'opacity-60'}"
            role="button"
            tabindex={currentCard ? 0 : -1}
            aria-disabled={!currentCard}
            on:click={() => {
              if (!currentCard) return;
              cardFlipped = !cardFlipped;
              commitUrl();
            }}
            on:keydown={(event) => {
              if (!currentCard || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              cardFlipped = !cardFlipped;
              commitUrl();
            }}
          >
            {#if currentCard}
              <div class="grid max-w-3xl gap-4">
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
            <article class="min-h-32 rounded-md border border-line bg-panel p-3 shadow-sm">
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
</main>
