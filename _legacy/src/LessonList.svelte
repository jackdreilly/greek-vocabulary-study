<script>
  import { ChevronRight, Search, ChevronLeft, Sparkles, BookOpen, Volume2, Hash, Info, X } from "lucide-svelte";
  import { textMatchesSearch } from "./lib/search.js";
  import { renderMarkdown } from "./lib/markdown.js";

  export let lessons = [];
  export let courseName = "";
  export let courseDescription = "";
  export let courseSourcePrompt = "";
  export let onOpenLesson = () => {};
  export let onBack = () => {};
  export let onGenerateLesson = null;

  let search = "";
  let aboutOpen = false;

  function lessonProgress(lesson) {
    if (!lesson?.entry_count) return 0;
    return Math.round((lesson.translated_count / lesson.entry_count) * 100);
  }

  const COURSE_PALETTES = [
    { bg: "#fff8f0", accent: "#a65318", pill: "#fdebd0", grad: "linear-gradient(135deg, #fff3e3 0%, #fde8c8 100%)" },
    { bg: "#f0f4ff", accent: "#2952b3", pill: "#dce7ff", grad: "linear-gradient(135deg, #edf2ff 0%, #d4e0ff 100%)" },
    { bg: "#f3fff5", accent: "#1a7a40", pill: "#d2f5dc", grad: "linear-gradient(135deg, #edfff2 0%, #ccf5d8 100%)" },
    { bg: "#fff5f7", accent: "#a33f55", pill: "#f9dbe2", grad: "linear-gradient(135deg, #fff0f3 0%, #f8d8df 100%)" },
    { bg: "#f3fbff", accent: "#1f6e87", pill: "#d4edf5", grad: "linear-gradient(135deg, #edfaff 0%, #d4edf5 100%)" },
  ];

  function hashName(name) {
    return [...String(name || "")].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  }

  $: colors = COURSE_PALETTES[hashName(courseName) % COURSE_PALETTES.length];
  $: filtered = lessons.filter(l => textMatchesSearch(l.title, search));
  $: totalWords = lessons.reduce((s, l) => s + (l.entry_count ?? 0), 0);
  $: totalMeanings = lessons.reduce((s, l) => s + (l.translated_count ?? 0), 0);
  $: totalAudio = lessons.reduce((s, l) => s + (l.audio_count ?? 0), 0);
  $: hasDescription = (courseDescription || "").trim().length > 0;
  $: hasSourcePrompt = (courseSourcePrompt || "").trim().length > 0;
  $: hasAbout = hasDescription || hasSourcePrompt;
</script>

<div class="lesson-list">
  <button class="back-btn" on:click={onBack}>
    <ChevronLeft size={18} />
    <span>All Courses</span>
  </button>

  <!-- Hero card: gradient banner + course identity + KPIs -->
  <header class="hero" style="--bg:{colors.bg}; --accent:{colors.accent}; --pill:{colors.pill}; --grad:{colors.grad}">
    <div class="hero-banner">
      <div class="hero-icon"><BookOpen size={28} /></div>
    </div>
    <div class="hero-body">
      <div class="hero-top">
        <h1 class="course-title">{courseName}</h1>
        {#if onGenerateLesson}
          <button class="gen-lesson-btn" type="button" on:click={onGenerateLesson}>
            <Sparkles size={14} /> Generate Lesson
          </button>
        {/if}
      </div>

      <div class="kpis">
        <div class="kpi">
          <Hash size={14} />
          <span class="kpi-val">{lessons.length}</span>
          <span class="kpi-label">lesson{lessons.length !== 1 ? "s" : ""}</span>
        </div>
        <div class="kpi">
          <BookOpen size={14} />
          <span class="kpi-val">{totalWords.toLocaleString()}</span>
          <span class="kpi-label">words</span>
        </div>
        {#if totalAudio > 0}
          <div class="kpi">
            <Volume2 size={14} />
            <span class="kpi-val">{totalAudio.toLocaleString()}</span>
            <span class="kpi-label">audio</span>
          </div>
        {/if}
        {#if totalWords > 0}
          <div class="kpi">
            <span class="kpi-val">{Math.round((totalMeanings / totalWords) * 100)}%</span>
            <span class="kpi-label">translated</span>
          </div>
        {/if}
      </div>

      {#if hasAbout}
        <button class="about-toggle mobile-only" type="button" on:click={() => (aboutOpen = !aboutOpen)}>
          <Info size={14} /> About this course
        </button>
      {/if}
    </div>
  </header>

  <!-- Two-column main area: Lessons (primary) + About (sidebar) -->
  <div class="main-grid" class:has-aside={hasAbout}>
    <section class="panel lessons-panel" style="--accent:{colors.accent}; --pill:{colors.pill}; --bg:{colors.bg}">
      <div class="panel-header">
        <div class="panel-title-row">
          <h2 class="panel-title">Lessons</h2>
          <span class="panel-count" style="background:{colors.pill}; color:{colors.accent}">
            {filtered.length}{search ? ` / ${lessons.length}` : ""}
          </span>
        </div>
        <div class="search-box">
          <Search class="search-icon" size={16} />
          <input
            type="search"
            bind:value={search}
            placeholder="Find a lesson..."
            class="search-input"
            style="--focus-color:{colors.accent}"
          />
        </div>
      </div>

      {#if filtered.length === 0}
        <div class="empty">
          <p>No lessons match <strong>"{search}"</strong>.</p>
          <button class="empty-clear" on:click={() => (search = "")}>Clear search</button>
        </div>
      {:else}
        <div class="grid">
          {#each filtered as lesson, i}
            {@const lessonNumber = lesson.displayNumber ?? lesson.lessonNumber ?? lesson.order ?? i + 1}
            <button
              class="card"
              style="--bg:{colors.bg}; --accent:{colors.accent}; --pill:{colors.pill}"
              on:click={() => onOpenLesson(lesson.id)}
            >
              <div class="card-top">
                <div class="num">{lessonNumber}</div>
                <h3 class="card-title">{lesson.title}</h3>
                <ChevronRight class="arrow" size={18} />
              </div>

              <div class="progress-track">
                <div class="progress-fill" style="width:{lessonProgress(lesson)}%"></div>
              </div>

              <div class="stats-row">
                <span class="badge">{lesson.entry_count.toLocaleString()} words</span>
                <span class="badge">{lesson.translated_count.toLocaleString()} meanings</span>
                {#if lesson.audio_count}
                  <span class="badge">{lesson.audio_count.toLocaleString()} audio</span>
                {/if}
              </div>

              <div class="card-footer">
                <span class="cta">Start <ChevronRight size={14} /></span>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </section>

    {#if hasAbout}
      <aside class="panel about-panel desktop-only" style="--accent:{colors.accent}; --pill:{colors.pill}">
        <div class="panel-header about-header">
          <h2 class="panel-title"><Info size={16} /> About this course</h2>
        </div>
        <div class="about-scroll markdown-body">
          {#if hasDescription}
            {@html renderMarkdown(courseDescription)}
          {/if}
          {#if hasSourcePrompt}
            <details class="source-prompt-nugget">
              <summary>Original prompt</summary>
              <p>{courseSourcePrompt}</p>
            </details>
          {/if}
        </div>
      </aside>
    {/if}
  </div>
</div>

<!-- Mobile-only About drawer -->
{#if hasAbout && aboutOpen}
  <div class="drawer-scrim" on:click={() => (aboutOpen = false)} role="presentation"></div>
  <aside
    class="drawer mobile-only"
    style="--accent:{colors.accent}; --pill:{colors.pill}"
    role="dialog"
    aria-label="About this course"
  >
    <div class="drawer-header">
      <h2 class="panel-title"><Info size={16} /> About this course</h2>
      <button class="drawer-close" type="button" on:click={() => (aboutOpen = false)} aria-label="Close">
        <X size={18} />
      </button>
    </div>
    <div class="drawer-body markdown-body">
      {#if hasDescription}
        {@html renderMarkdown(courseDescription)}
      {/if}
      {#if hasSourcePrompt}
        <details class="source-prompt-nugget">
          <summary>Original prompt</summary>
          <p>{courseSourcePrompt}</p>
        </details>
      {/if}
    </div>
  </aside>
{/if}

<style>
  .lesson-list {
    max-width: 1240px;
    margin: 0 auto;
    padding: 28px 24px 64px;
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
    color: #667085;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    margin-bottom: 18px;
    transition: color 0.2s;
  }
  .back-btn:hover { color: #202124; }

  /* ===== Hero card ===== */
  .hero {
    border-radius: 20px;
    border: 1.5px solid color-mix(in srgb, var(--accent) 18%, transparent);
    background: #fff;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    margin-bottom: 24px;
  }

  .hero-banner {
    background: var(--grad);
    height: 70px;
    display: flex;
    align-items: center;
    padding: 0 28px;
  }
  .hero-icon {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: rgba(255,255,255,0.7);
    color: var(--accent);
    backdrop-filter: blur(6px);
  }

  .hero-body {
    padding: 18px 28px 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .hero-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .course-title {
    font-size: 28px;
    font-weight: 900;
    margin: 0;
    letter-spacing: -0.02em;
    color: var(--accent);
  }

  .kpis {
    display: flex;
    flex-wrap: wrap;
    gap: 18px 24px;
    align-items: center;
  }
  .kpi {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    color: #4a5160;
    font-size: 13px;
  }
  .kpi :global(svg) {
    color: var(--accent);
    transform: translateY(2px);
  }
  .kpi-val {
    font-weight: 800;
    font-size: 17px;
    color: #202124;
    letter-spacing: -0.01em;
  }
  .kpi-label {
    color: #667085;
    font-weight: 500;
  }

  .gen-lesson-btn {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 9px 16px; border-radius: 10px; border: none;
    background: var(--accent); color: #fff;
    font-size: 13px; font-weight: 700; cursor: pointer;
    opacity: 0.9; transition: opacity 0.2s, box-shadow 0.2s;
    white-space: nowrap;
  }
  .gen-lesson-btn:hover {
    opacity: 1;
    box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .about-toggle {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 14px; border-radius: 10px;
    border: 1.5px solid color-mix(in srgb, var(--accent) 25%, transparent);
    background: #fff; color: var(--accent);
    font-size: 13px; font-weight: 700; cursor: pointer;
    width: fit-content;
    transition: background 0.2s;
  }
  .about-toggle:hover { background: var(--pill); }

  /* ===== Two-column main grid ===== */
  .main-grid {
    display: grid;
    gap: 24px;
    grid-template-columns: 1fr;
  }
  .main-grid.has-aside {
    grid-template-columns: minmax(0, 1fr);
  }
  @media (min-width: 1000px) {
    .main-grid.has-aside {
      grid-template-columns: minmax(340px, 0.78fr) minmax(480px, 1.22fr);
      align-items: start;
    }
  }

  /* ===== Panels ===== */
  .panel {
    border-radius: 18px;
    border: 1.5px solid #e5e8f0;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,0.03);
    overflow: hidden;
  }

  .panel-header {
    padding: 18px 22px 14px;
    border-bottom: 1px solid #eef0f5;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .panel-title-row {
    display: flex; align-items: center; gap: 10px;
  }
  .panel-title {
    font-size: 18px;
    font-weight: 800;
    margin: 0;
    color: #202124;
    letter-spacing: -0.01em;
    display: inline-flex; align-items: center; gap: 8px;
  }
  .panel-title :global(svg) { color: var(--accent); }
  .panel-count {
    font-size: 12px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 20px;
  }

  /* Lessons panel */
  .lessons-panel { padding-bottom: 22px; }
  .lessons-panel,
  .about-panel {
    min-width: 0;
  }

  .search-box {
    position: relative;
    width: 100%;
    max-width: 380px;
  }
  :global(.search-icon) {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: #99a1b3;
    pointer-events: none;
  }
  .search-input {
    width: 100%;
    height: 40px;
    padding: 0 14px 0 38px;
    border-radius: 10px;
    border: 1.5px solid #d9dee7;
    background: #fff;
    font-size: 14px;
    transition: border-color 0.2s, box-shadow 0.2s;
    box-sizing: border-box;
  }
  .search-input:focus {
    outline: none;
    border-color: var(--focus-color);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus-color) 12%, transparent);
  }

  .empty {
    padding: 36px 22px;
    text-align: center;
    color: #667085;
  }
  .empty p { margin: 0 0 12px; }
  .empty-clear {
    background: none;
    border: 1.5px solid #d9dee7;
    padding: 6px 14px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    color: #4a5160;
  }

  .grid {
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    padding: 18px 22px 0;
  }

  /* Lesson Card */
  .card {
    display: flex;
    flex-direction: column;
    padding: 16px;
    border-radius: 12px;
    border: 1.5px solid color-mix(in srgb, var(--accent) 15%, transparent);
    background: var(--bg);
    text-align: left;
    cursor: pointer;
    transition: transform 0.22s cubic-bezier(0.4,0,0.2,1), box-shadow 0.22s, border-color 0.2s;
    box-shadow: 0 1px 4px rgba(0,0,0,0.04);
  }
  .card:hover {
    transform: translateY(-3px);
    border-color: var(--accent);
    box-shadow: 0 8px 20px color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .card-top {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 12px;
  }
  .num {
    display: grid;
    place-items: center;
    min-width: 30px;
    height: 30px;
    border-radius: 8px;
    background: var(--pill);
    color: var(--accent);
    font-size: 13px;
    font-weight: 800;
    flex-shrink: 0;
    padding: 0 5px;
  }
  .card-title {
    flex: 1;
    font-size: 14px;
    font-weight: 700;
    line-height: 1.35;
    color: #202124;
    margin: 0;
  }
  :global(.arrow) {
    color: #d9dee7;
    flex-shrink: 0;
    margin-top: 2px;
    transition: transform 0.2s, color 0.2s;
  }
  .card:hover :global(.arrow) {
    color: var(--accent);
    transform: translateX(3px);
  }

  .progress-track {
    height: 4px;
    background: color-mix(in srgb, var(--accent) 10%, white);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 10px;
  }
  .progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    opacity: 0.65;
  }

  .stats-row {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-bottom: 12px;
  }
  .badge {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    background: var(--pill);
    padding: 2px 8px;
    border-radius: 5px;
  }
  .card-footer { margin-top: auto; }
  .cta {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--accent);
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    padding: 6px 12px;
    border-radius: 8px;
    opacity: 0.85;
    transition: opacity 0.2s;
  }
  .card:hover .cta { opacity: 1; }

  /* ===== About sidebar ===== */
  .about-panel {
    position: sticky;
    top: 20px;
    max-height: calc(100vh - 40px);
    display: flex;
    flex-direction: column;
  }
  .about-header { padding: 16px 20px; }
  .about-scroll {
    overflow-y: auto;
    padding: 16px 20px 22px;
    font-size: 14px;
    line-height: 1.65;
    color: #202124;
  }

  /* Markdown styling within about panel and mobile drawer */
  .markdown-body :global(h1) {
    font-size: 18px; font-weight: 800; margin: 0 0 10px;
    color: var(--accent); letter-spacing: -0.01em;
  }
  .markdown-body :global(h2) {
    font-size: 15px; font-weight: 800; margin: 18px 0 6px;
    color: #202124; letter-spacing: -0.01em;
  }
  .markdown-body :global(h3) {
    font-size: 13px; font-weight: 700; margin: 14px 0 4px; color: #202124;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .markdown-body :global(p) { margin: 6px 0; }
  .markdown-body :global(ul),
  .markdown-body :global(ol) { margin: 6px 0; padding-left: 1.3rem; }
  .markdown-body :global(li + li) { margin-top: 3px; }
  .markdown-body :global(strong) { color: #202124; }
  .markdown-body :global(em) { color: var(--accent); font-style: italic; }
  .markdown-body :global(blockquote) {
    border-left: 3px solid var(--accent);
    background: var(--pill);
    margin: 10px 0;
    padding: 6px 12px;
    border-radius: 0 8px 8px 0;
    font-style: italic;
    font-size: 13px;
  }
  .markdown-body :global(code) {
    background: #f0f2f7; padding: 1px 6px; border-radius: 4px;
    font-size: 0.9em;
  }
  .markdown-body :global(hr) {
    border: none; border-top: 1px solid #e5e8f0; margin: 14px 0;
  }
  .markdown-body :global(a) { color: var(--accent); text-decoration: underline; }
  .source-prompt-nugget {
    margin-top: 16px;
    padding-top: 10px;
    border-top: 1px solid #e5e8f0;
    color: #667085;
    font-size: 12px;
    line-height: 1.5;
  }
  .source-prompt-nugget summary {
    cursor: pointer;
    font-weight: 700;
    color: #667085;
  }
  .source-prompt-nugget p {
    margin: 8px 0 0;
    white-space: pre-wrap;
  }

  /* ===== Mobile drawer ===== */
  .drawer-scrim {
    position: fixed; inset: 0;
    background: rgba(20,22,30,0.45);
    z-index: 50;
    backdrop-filter: blur(2px);
  }
  .drawer {
    position: fixed;
    z-index: 51;
    left: 12px; right: 12px; bottom: 12px;
    max-height: 80vh;
    background: #fff;
    border-radius: 18px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.25);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .drawer-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid #eef0f5;
  }
  .drawer-close {
    background: none; border: none; cursor: pointer;
    color: #667085; padding: 4px; display: grid; place-items: center;
    border-radius: 6px;
  }
  .drawer-close:hover { background: #f0f2f7; color: #202124; }
  .drawer-body {
    overflow-y: auto;
    padding: 16px 20px 22px;
    font-size: 14px;
    line-height: 1.65;
    color: #202124;
  }

  /* ===== Responsive visibility ===== */
  .mobile-only { display: none; }
  .desktop-only { display: flex; }
  @media (max-width: 999px) {
    .mobile-only { display: inline-flex; }
    .desktop-only { display: none; }
    .course-title { font-size: 24px; }
    .hero-body { padding: 16px 20px 18px; }
    .hero-banner { padding: 0 20px; height: 56px; }
    .panel-header { padding: 14px 16px 12px; }
    .grid { padding: 14px 16px 0; gap: 12px; }
  }
</style>
