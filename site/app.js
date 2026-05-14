const state = {
  data: null,
  theme: "all",
  category: "all",
  subsection: "all",
  search: "",
  translatedOnly: true,
  flashcardsOpen: false,
  flashcardIndex: 0,
  flashcardFlipped: false,
  deck: [],
  deckOrderIds: null,
  currentAudio: null,
};

const ENTRY_RENDER_LIMIT = 500;
const STUDY_ENTRY_RENDER_LIMIT = 48;

const els = {
  entryCount: document.querySelector("#entryCount"),
  translationCount: document.querySelector("#translationCount"),
  audioCount: document.querySelector("#audioCount"),
  visibleCount: document.querySelector("#visibleCount"),
  shortcutsToggle: document.querySelector("#shortcutsToggle"),
  shortcutsDialog: document.querySelector("#shortcutsDialog"),
  shortcutsClose: document.querySelector("#shortcutsClose"),
  search: document.querySelector("#search"),
  themeChips: document.querySelector("#themeChips"),
  categoryChips: document.querySelector("#categoryChips"),
  subsectionChips: document.querySelector("#subsectionChips"),
  translatedOnly: document.querySelector("#translatedOnly"),
  clearFilters: document.querySelector("#clearFilters"),
  entries: document.querySelector("#entries"),
  flashcardToggle: document.querySelector("#flashcardToggle"),
  flashcards: document.querySelector("#flashcards"),
  deckCount: document.querySelector("#deckCount"),
  shuffleDeck: document.querySelector("#shuffleDeck"),
  prevCard: document.querySelector("#prevCard"),
  flipCard: document.querySelector("#flipCard"),
  nextCard: document.querySelector("#nextCard"),
  studyCard: document.querySelector("#studyCard"),
  cardSide: document.querySelector("#cardSide"),
  cardPrompt: document.querySelector("#cardPrompt"),
  cardAnswer: document.querySelector("#cardAnswer"),
  cardMeta: document.querySelector("#cardMeta"),
};

const normalise = (value) =>
  String(value ?? "")
    .toLocaleLowerCase("el")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getSenses(entry) {
  if (Array.isArray(entry.english_senses) && entry.english_senses.length) {
    return entry.english_senses;
  }
  return entry.english ? entry.english.split(/\s*;\s*/).filter(Boolean) : [];
}

function renderSenseList(entry, limit = 4) {
  const senses = getSenses(entry);
  if (!senses.length) {
    return `<div class="entryEnglish missing">Meaning not available yet</div>`;
  }

  const visible = senses.slice(0, limit);
  const extra = senses.length - visible.length;
  const items = visible.map((sense) => `<li>${escapeHtml(sense)}</li>`).join("");
  const more = extra > 0 ? `<li class="moreSense">+${extra} more</li>` : "";
  return `<ol class="senseList">${items}${more}</ol>`;
}

function renderFlashcardSenses(entry) {
  const senses = getSenses(entry);
  if (!senses.length) return "Meaning not available yet";

  return `
    <ol class="flashcardSenses">
      ${senses
        .map((sense, index) => `
          <li class="${index === 0 ? "primarySense" : ""}">${escapeHtml(sense)}</li>
        `)
        .join("")}
    </ol>
  `;
}

function fillChips(container, values, currentStateKey, firstLabel) {
  const chips = [
    { value: "all", label: firstLabel }
  ].concat(values.map(v => ({ value: v, label: displayLabel(v) })));

  const nodes = chips.map(chip => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = `chip ${state[currentStateKey] === String(chip.value) ? "active" : ""}`;
    node.textContent = chip.label;
    node.addEventListener("click", () => {
      state[currentStateKey] = state[currentStateKey] === String(chip.value) ? "all" : String(chip.value);
      resetCardPosition();
      render();
    });
    return node;
  });
  container.replaceChildren(...nodes);
}

function displayLabel(value) {
  const labels = {
    Ουσιαστικά: "Nouns",
    Επίθετα: "Adjectives",
    Ρήματα: "Verbs",
    Εκφράσεις: "Phrases",
    SilentShuffle: "Top 5000",
    art: "Article",
    "art.": "Article",
    part: "Particle",
    "part.": "Particle",
    v: "Verb",
    "v.": "Verb",
    n: "Noun",
    "n.": "Noun",
    adj: "Adjective",
    "adj.": "Adjective",
    adv: "Adverb",
    "adv.": "Adverb",
    prep: "Preposition",
    "prep.": "Preposition",
    pron: "Pronoun",
    "pron.": "Pronoun",
  };
  return labels[value] ?? value;
}

function getAudioUrl(path) {
  if (!path) return "";
  const bucket = "didibros-6d3ed.firebasestorage.app";
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
}

function updateFilters() {
  const { entries, themes } = state.data;

  const matchesExcluding = (entry, exclude) => {
    if (exclude !== "theme" && state.theme !== "all" && String(entry.theme_id) !== state.theme) return false;
    if (exclude !== "category" && state.category !== "all" && entry.category !== state.category) return false;
    if (exclude !== "subsection" && state.subsection !== "all" && entry.subsection !== state.subsection) return false;
    if (exclude !== "translatedOnly" && state.translatedOnly && !entry.english) return false;
    if (exclude !== "search" && !matchesSearch(entry)) return false;
    return true;
  };

  // 1. Themes
  const themeValues = themes.map(t => String(t.id));
  fillChips(els.themeChips, themeValues, "theme", "All topics");

  // 2. Categories
  const categories = [...new Set(entries.filter(e => matchesExcluding(e, "category")).map(e => e.category))].sort();
  fillChips(els.categoryChips, categories, "category", "All types");
  if (state.category !== "all" && !categories.includes(state.category)) {
    state.category = "all";
    fillChips(els.categoryChips, categories, "category", "All types");
  }

  // 3. Subsections
  const subsections = [...new Set(entries.filter(e => matchesExcluding(e, "subsection")).map(e => e.subsection).filter(Boolean))].sort();
  fillChips(els.subsectionChips, subsections, "subsection", "All groups");
  if (state.subsection !== "all" && !subsections.includes(state.subsection)) {
    state.subsection = "all";
    fillChips(els.subsectionChips, subsections, "subsection", "All groups");
  }
}

function setupFilters() {
  updateFilters();
}

function matchesSearch(entry) {
  if (!state.search) return true;
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
      entry.page,
      entry.frequency_rank,
    ].join(" "),
  );
  return haystack.includes(normalise(state.search));
}

function getFilteredEntries() {
  return state.data.entries.filter((entry) => {
    if (state.theme !== "all" && String(entry.theme_id) !== state.theme) return false;
    if (state.category !== "all" && entry.category !== state.category) return false;
    if (state.subsection !== "all" && entry.subsection !== state.subsection) return false;
    if (state.translatedOnly && !entry.english) return false;
    return matchesSearch(entry);
  });
}

function getDeckEntries(entries) {
  const deck = state.translatedOnly ? entries.filter((entry) => entry.english) : entries;
  if (!state.deckOrderIds) return deck;

  const byId = new Map(deck.map((entry) => [entry.id, entry]));
  const ordered = state.deckOrderIds
    .map((id) => byId.get(id))
    .filter(Boolean);
  const orderedIds = new Set(ordered.map((entry) => entry.id));
  return [...ordered, ...deck.filter((entry) => !orderedIds.has(entry.id))];
}

function renderEntries(entries) {
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No words match the current filters.";
    els.entries.replaceChildren(empty);
    return;
  }

  const limit = state.flashcardsOpen ? STUDY_ENTRY_RENDER_LIMIT : ENTRY_RENDER_LIMIT;
  const cards = entries.slice(0, limit).map((entry) => {
    const card = document.createElement("article");
    card.className = "entry";
    const article = entry.article ? `<span class="tag">${entry.article}</span>` : "";
    const subsection = entry.subsection ? `<span class="tag">${displayLabel(entry.subsection)}</span>` : "";
    const english = renderSenseList(entry);
    const location = entry.frequency_rank
      ? `<span class="tag page">#${entry.frequency_rank}</span>`
      : `<span class="tag page">p. ${entry.page}</span>`;
    const audio = entry.audio_path
      ? `<button class="audioButton" type="button" data-audio="${escapeHtml(getAudioUrl(entry.audio_path))}" aria-label="Play pronunciation" title="Play pronunciation">▶</button>`
      : "";
    card.innerHTML = `
      <div class="entryTopline">
        <div class="entryTerm">${entry.lemma}</div>
        ${audio}
      </div>
      ${english}
      <div class="entryMeta">
        ${article}
        <span class="tag category">${displayLabel(entry.category)}</span>
        ${subsection}
        ${location}
      </div>
    `;
    card.title = entry.term;
    return card;
  });

  if (entries.length > limit) {
    const note = document.createElement("div");
    note.className = "empty";
    note.textContent = state.flashcardsOpen
      ? `Previewing ${limit} of ${entries.length.toLocaleString()} words below. The study set includes all ${entries.length.toLocaleString()}.`
      : `Showing ${limit} of ${entries.length.toLocaleString()} words. Search or choose a topic to narrow the list.`;
    cards.push(note);
  }

  els.entries.replaceChildren(...cards);
}

function renderFlashcards(filteredEntries) {
  state.deck = getDeckEntries(filteredEntries);
  els.flashcards.hidden = !state.flashcardsOpen;
  els.deckCount.textContent = `${state.deck.length.toLocaleString()} cards`;
  els.flashcardToggle.textContent = state.flashcardsOpen ? "Hide study cards" : "Study cards";

  const hasCards = state.deck.length > 0;
  [els.shuffleDeck, els.prevCard, els.flipCard, els.nextCard, els.studyCard].forEach((button) => {
    button.disabled = !hasCards;
  });

  if (!hasCards) {
    els.cardSide.textContent = "No cards";
    els.cardPrompt.textContent = "No study cards in this set.";
    els.cardAnswer.textContent = state.translatedOnly
      ? "Turn off translated-only study to include words without meanings."
      : "Try a different topic or search.";
    els.cardMeta.textContent = "";
    return;
  }

  if (state.flashcardIndex >= state.deck.length) {
    state.flashcardIndex = 0;
  }

  const entry = state.deck[state.flashcardIndex];
  els.studyCard.classList.toggle("flipped", state.flashcardFlipped);
  els.cardSide.textContent = state.flashcardFlipped ? "English" : "Greek";
  if (state.flashcardFlipped) {
    els.cardPrompt.innerHTML = renderFlashcardSenses(entry);
  } else {
    els.cardPrompt.textContent = entry.lemma;
  }
  els.cardAnswer.innerHTML = `
    <span>${escapeHtml(state.flashcardFlipped ? entry.lemma : "Tap to reveal meaning")}</span>
    ${entry.audio_path ? `<button class="playOnceButton" type="button" aria-label="Play pronunciation" title="Play pronunciation">▶</button>` : ""}
  `;
  const location = entry.frequency_rank ? `#${entry.frequency_rank}` : `p. ${entry.page}`;
  els.cardMeta.textContent = `${state.flashcardIndex + 1} / ${state.deck.length.toLocaleString()} · ${entry.theme} · ${location}`;

  updateUrl();
}

function updateUrl() {
  const params = new URLSearchParams();
  if (state.theme !== "all") params.set("theme", state.theme);
  if (state.category !== "all") params.set("cat", state.category);
  if (state.subsection !== "all") params.set("sub", state.subsection);
  if (state.search) params.set("q", state.search);
  if (!state.translatedOnly) params.set("all", "1");
  if (state.flashcardsOpen) {
    params.set("mode", "cards");
    if (state.flashcardIndex > 0) params.set("card", state.flashcardIndex + 1);
  }

  const queryString = params.toString();
  const url = queryString ? `?${queryString}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

function render() {
  updateFilters();
  const entries = getFilteredEntries();
  els.visibleCount.textContent = `${entries.length} shown`;
  renderFlashcards(entries);
  renderEntries(entries);
}

function resetCardPosition() {
  state.flashcardIndex = 0;
  state.flashcardFlipped = false;
  state.deckOrderIds = null;
}

function moveCard(delta) {
  if (!state.deck.length) return;
  if (state.currentAudio) state.currentAudio.pause();
  state.flashcardIndex = (state.flashcardIndex + delta + state.deck.length) % state.deck.length;
  state.flashcardFlipped = false;
  renderFlashcards(getFilteredEntries());
}

function shuffleDeck() {
  const entries = getFilteredEntries();
  const shuffledDeck = getDeckEntries(entries);

  for (let index = shuffledDeck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffledDeck[index], shuffledDeck[swapIndex]] = [shuffledDeck[swapIndex], shuffledDeck[index]];
  }

  state.deckOrderIds = shuffledDeck.map((entry) => entry.id);
  state.flashcardIndex = 0;
  state.flashcardFlipped = false;
  render();
}

function toggleCurrentAudio() {
  if (!state.flashcardsOpen || !state.deck.length) return;
  const entry = state.deck[state.flashcardIndex];
  if (!entry?.audio_path) return;

  const url = getAudioUrl(entry.audio_path);
  if (!state.currentAudio || state.currentAudio.src !== url) {
    if (state.currentAudio) state.currentAudio.pause();
    state.currentAudio = new Audio(url);
  }

  if (state.currentAudio.paused) {
    state.currentAudio.play().catch(() => {});
  } else {
    state.currentAudio.pause();
  }
}

function playCurrentAudioOnce() {
  if (!state.flashcardsOpen || !state.deck.length) return;
  const entry = state.deck[state.flashcardIndex];
  if (!entry?.audio_path) return;

  if (state.currentAudio) state.currentAudio.pause();
  state.currentAudio = new Audio(getAudioUrl(entry.audio_path));
  state.currentAudio.play().catch(() => {});
}

function bindEvents() {
  els.search.addEventListener("input", (event) => {
    state.search = event.target.value;
    resetCardPosition();
    render();
  });
  els.translatedOnly.addEventListener("change", (event) => {
    state.translatedOnly = event.target.checked;
    resetCardPosition();
    render();
  });
  els.clearFilters.addEventListener("click", () => {
    state.theme = "all";
    state.category = "all";
    state.subsection = "all";
    state.search = "";
    state.translatedOnly = true;
    resetCardPosition();
    syncUiWithState();
    render();
  });
  els.flashcardToggle.addEventListener("click", () => {
    state.flashcardsOpen = !state.flashcardsOpen;
    render();
  });
  els.shortcutsToggle.addEventListener("click", () => {
    els.shortcutsDialog.showModal();
  });
  els.shortcutsClose.addEventListener("click", () => {
    els.shortcutsDialog.close();
  });
  els.shortcutsDialog.addEventListener("click", (event) => {
    if (event.target === els.shortcutsDialog) {
      els.shortcutsDialog.close();
    }
  });
  els.flipCard.addEventListener("click", () => {
    state.flashcardFlipped = !state.flashcardFlipped;
    renderFlashcards(getFilteredEntries());
  });
  els.studyCard.addEventListener("click", (event) => {
    if (event.target.closest(".playOnceButton")) {
      event.preventDefault();
      event.stopPropagation();
      playCurrentAudioOnce();
      return;
    }
    state.flashcardFlipped = !state.flashcardFlipped;
    renderFlashcards(getFilteredEntries());
  });
  els.prevCard.addEventListener("click", () => moveCard(-1));
  els.nextCard.addEventListener("click", () => moveCard(1));
  els.shuffleDeck.addEventListener("click", shuffleDeck);
  els.entries.addEventListener("click", (event) => {
    const button = event.target.closest("[data-audio]");
    if (!button) return;
    const player = new Audio(button.dataset.audio);
    player.play().catch(() => {});
  });
  document.addEventListener("keydown", (event) => {
    const isTyping = ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName);
    if (isTyping) return;
    if (event.key.toLowerCase() === "s" && !event.shiftKey) {
      event.preventDefault();
      state.flashcardsOpen = !state.flashcardsOpen;
      render();
      return;
    }
    if (!state.flashcardsOpen) return;
    if (event.key.toLowerCase() === "s" && event.shiftKey) {
      event.preventDefault();
      shuffleDeck();
      return;
    }
    if (event.key.toLowerCase() === "a") {
      event.preventDefault();
      toggleCurrentAudio();
      return;
    }
    if (event.key === "ArrowLeft") {
      moveCard(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      moveCard(1);
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      state.flashcardFlipped = !state.flashcardFlipped;
      renderFlashcards(getFilteredEntries());
    }
  });
}

function loadStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  state.theme = params.get("theme") || "all";
  state.category = params.get("cat") || "all";
  state.subsection = params.get("sub") || "all";
  state.search = params.get("q") || "";
  state.translatedOnly = !params.has("all");
  state.flashcardsOpen = params.get("mode") === "cards";
  const cardIndex = parseInt(params.get("card"), 10);
  if (!isNaN(cardIndex)) {
    state.flashcardIndex = Math.max(0, cardIndex - 1);
  }
}

function syncUiWithState() {
  els.search.value = state.search;
  els.translatedOnly.checked = state.translatedOnly;
}

async function init() {
  const response = await fetch("data/lexilogio.json");
  state.data = await response.json();
  els.entryCount.textContent = state.data.entries.length.toLocaleString();
  els.translationCount.textContent = state.data.entries
    .filter((entry) => entry.english)
    .length.toLocaleString();
  els.audioCount.textContent = state.data.entries
    .filter((entry) => entry.audio_available)
    .length.toLocaleString();
  
  loadStateFromUrl();
  setupFilters();
  syncUiWithState();
  bindEvents();
  render();
}

init().catch((error) => {
  els.entries.innerHTML = `<div class="empty">Could not load the collection: ${error.message}</div>`;
});
