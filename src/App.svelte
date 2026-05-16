<script>
  import { onMount } from "svelte";
  import {
    Home,
    Layers3,
    Sparkles,
    BookOpen,
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
  import { collection, getDocsFromServer, doc, updateDoc } from "firebase/firestore";
  import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
  
  // Components
  import LessonList from "./LessonList.svelte";
  import FlashcardsPage from "./FlashcardsPage.svelte";
  import AIPractice from "./AIPractice.svelte";
  import VocabPage from "./VocabPage.svelte";
  import YiaYiaChat from "./YiaYiaChat.svelte";

  // Data State
  let data = null;
  let loadError = "";
  let view = "lessons"; // "lessons" | "study"
  let activeTab = "cards"; // "cards" | "games" | "vocab"
  
  // Selection State
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

  // Search/Filters (Shared)
  let globalSearch = "";

  const TOP_5000_ID = 13;

  // Formatting helpers
const displayType = (v) => ({"Ουσιαστικά": "Nouns", "Επίθετα": "Adjectives", "Ρήματα": "Verbs", "Εκφράσεις": "Phrases", "Top 5000": "Top 5000"})[v] ?? v;
  const displayGroup = (k) => ({art:"Articles", part:"Particles", v:"Verbs", n:"Nouns", adj:"Adjectives", adv:"Adverbs", prep:"Prepositions", pron:"Pronouns", conj:"Conjunctions", interj:"Interjections", det:"Determiners", num:"Numbers", coll:"Collective"})[k] ?? k;

  async function loadData() {
    try {
      const fetchFirestore = async () => {
        const [tSnap, eSnap] = await Promise.all([
          getDocsFromServer(collection(db, "themes")),
          getDocsFromServer(collection(db, "entries"))
        ]);
        return { themes: tSnap.docs.map(d => d.data()), entries: eSnap.docs.map(d => d.data()) };
      };
      const fetchLocal = async () => (await fetch("/data/lexilogio.json")).json();
      
      const payload = await Promise.race([
        fetchFirestore(),
        new Promise((_, r) => setTimeout(() => r(new Error("Timeout")), 10000))
      ]).catch(fetchLocal);
      
      data = prepareData(payload);
      loadStateFromUrl();
    } catch (e) {
      loadError = e.message;
    }
  }

  function prepareData(payload) {
    const entries = payload.entries.map(e => ({
      ...e,
      theme: Number(e.theme_id) === TOP_5000_ID ? "Top 5000" : e.theme,
      category: e.category === "SilentShuffle" ? "Top 5000" : (e.category || "Top 5000"),
      english_senses: Array.isArray(e.english_senses) && e.english_senses.length ? e.english_senses : (e.english ? e.english.split(/\s*;\s*/).filter(Boolean) : []),
      groupKeys: groupKeysFrom(e.subsection)
    }));
    const themes = payload.themes.map(t => {
      const tEntries = entries.filter(e => e.theme_id === t.id);
      return { ...t, title: Number(t.id) === TOP_5000_ID ? "Top 5000" : t.title, entry_count: tEntries.length, translated_count: tEntries.filter(e => e.english).length, audio_count: tEntries.filter(e => e.audio_available).length };
    }).sort((a, b) => Number(a.id) - Number(b.id));
    return { themes, entries: entries.sort((a,b) => Number(a.id) - Number(b.id)) };
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
    
    if (lessonMatch) {
      selectedLessonId = Number(lessonMatch[1]);
      view = "study";
      activeTab = tabMatch?.[1] || "cards";
    } else {
      view = "lessons";
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
    
    let url = view === "lessons" ? "/lessons" : `/lesson/${selectedLessonId}/${activeTab}`;
    const searchStr = params.toString();
    url += searchStr ? "?" + searchStr : "";
    
    if (push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }

  function openLesson(id) {
    selectedLessonId = id;
    view = "study";
    activeTab = "cards";
    cardIndex = 0;
    cardFlipped = false;
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

  function openEdit(entry) { editingEntry = JSON.parse(JSON.stringify(entry)); }
  function closeEdit() { editingEntry = null; }
  async function saveEdit() {
    if (!editingEntry) return;
    await updateDoc(doc(db, "entries", String(editingEntry.id)), { english_senses: editingEntry.english_senses || [], image: editingEntry.image || null });
    data.entries = data.entries.map(e => e.id === editingEntry.id ? { ...editingEntry } : e);
    data = { ...data };
    closeEdit();
  }

  $: selectedLesson = data?.themes.find(t => t.id === selectedLessonId);
  $: lessonEntries = data?.entries.filter(e => e.theme_id === selectedLessonId) ?? [];
  
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

  onMount(loadData);
</script>

<svelte:window on:keydown={handleKeydown} on:popstate={loadStateFromUrl} />

<div class="app-shell">
  <header class="app-header">
    <div class="nav-left">
      <button class="brand" on:click={showLessons}>
        <img src="/fanari-icon.png" alt="" class="icon" />
        <span>Fanari Go</span>
      </button>
      
      {#if view === "study" && selectedLesson}
        <div class="lesson-indicator">
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
    {#if !data}
      <div class="loading-state">
        <LoaderCircle class="animate-spin" size={48} />
        <p>Illuminating vocabulary...</p>
      </div>
    {:else if view === "lessons"}
      <LessonList lessons={data.themes} onOpenLesson={openLesson} />
    {:else}
      <div class="study-layout">
        <aside class="sidebar" class:open={lessonSidebarOpen}>
          <button class="back-btn" on:click={showLessons}>
            <Home size={18} />
            <span>All Lessons</span>
          </button>

          <nav class="tabs-nav">
            <button class:active={activeTab === 'cards'} on:click={() => setTab('cards')}>
              <BookOpen size={18} /> <span>Flashcards</span>
            </button>
            <button class:active={activeTab === 'games'} on:click={() => setTab('games')}>
              <Sparkles size={18} /> <span>Games</span>
            </button>
            <button class:active={activeTab === 'vocab'} on:click={() => setTab('vocab')}>
              <Layers3 size={18} /> <span>Vocabulary</span>
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
          </header>

          <div class="page-container">
            {#if activeTab === 'cards'}
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
        <h2>Edit Word</h2>
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
      </div>
      <div class="modal-footer">
        <button class="cancel" on:click={closeEdit}>Cancel</button>
        <button class="save" on:click={saveEdit}>Save</button>
      </div>
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
  .lesson-indicator { display: flex; align-items: center; gap: 8px; color: #667085; font-size: 14px; font-weight: 600; }
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

  @media (max-width: 768px) {
    .sidebar { position: absolute; left: 0; top: 0; bottom: 0; transform: translateX(-100%); }
    .sidebar.open { transform: translateX(0); width: 260px; box-shadow: 20px 0 40px rgba(0,0,0,0.1); }
    .sidebar-backdrop { display: block; position: absolute; inset: 0; background: rgba(32,33,36,0.3); z-index: 10; }
  }
</style>
