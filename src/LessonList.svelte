<script>
  import { ChevronRight, Search, ChevronLeft } from "lucide-svelte";
  import { textMatchesSearch } from "./lib/search.js";

  export let lessons = [];
  export let courseName = "";
  export let onOpenLesson = () => {};
  export let onBack = () => {};

  let search = "";

  function lessonProgress(lesson) {
    if (!lesson?.entry_count) return 0;
    return Math.round((lesson.translated_count / lesson.entry_count) * 100);
  }

  const COURSE_COLORS = {
    "Afrodite Lourbakos":         { bg: "#fff8f0", accent: "#c2621c", pill: "#fdebd0" },
    "Top 5000":                   { bg: "#f0f4ff", accent: "#2952b3", pill: "#dce7ff" },
    "3rd Grade A1 Certification": { bg: "#f3fff5", accent: "#1a7a40", pill: "#d2f5dc" },
    "Every Day Greek":            { bg: "#fdf3ff", accent: "#7a1a8e", pill: "#f0d5ff" },
  };

  $: colors = COURSE_COLORS[courseName] ?? { bg: "#f7f8fb", accent: "#444", pill: "#e5e8ef" };
  $: filtered = lessons.filter(l => textMatchesSearch(l.title, search));
</script>

<div class="lesson-list">
  <header class="page-header">
    <button class="back-btn" on:click={onBack}>
      <ChevronLeft size={18} />
      <span>All Courses</span>
    </button>

    <div class="header-row">
      <h1 class="course-title" style="color:{colors.accent}">{courseName}</h1>
      <span class="lesson-count" style="background:{colors.pill}; color:{colors.accent}">
        {lessons.length} lessons
      </span>
    </div>

    <div class="search-box">
      <Search class="search-icon" size={18} />
      <input
        type="search"
        bind:value={search}
        placeholder="Find a lesson..."
        class="search-input"
        style="--focus-color:{colors.accent}"
      />
    </div>
  </header>

  <div class="grid">
    {#each filtered as lesson}
      <button
        class="card"
        style="--bg:{colors.bg}; --accent:{colors.accent}; --pill:{colors.pill}"
        on:click={() => onOpenLesson(lesson.id)}
      >
        <div class="card-top">
          <div class="num">{lesson.id > 1300 ? lesson.id - 1300 : lesson.id}</div>
          <h2 class="card-title">{lesson.title}</h2>
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
</div>

<style>
  .lesson-list {
    max-width: 1100px;
    margin: 0 auto;
    padding: 36px 24px 64px;
  }

  .page-header {
    margin-bottom: 36px;
    display: flex;
    flex-direction: column;
    gap: 16px;
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
    transition: color 0.2s;
    width: fit-content;
  }

  .back-btn:hover { color: #202124; }

  .header-row {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }

  .course-title {
    font-size: 30px;
    font-weight: 900;
    margin: 0;
    letter-spacing: -0.02em;
  }

  .lesson-count {
    font-size: 13px;
    font-weight: 700;
    padding: 4px 12px;
    border-radius: 20px;
  }

  .search-box {
    position: relative;
    max-width: 360px;
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
    height: 44px;
    padding: 0 16px 0 42px;
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

  /* Grid */
  .grid {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }

  /* Card */
  .card {
    display: flex;
    flex-direction: column;
    padding: 18px;
    border-radius: 14px;
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
    margin-bottom: 14px;
  }

  .num {
    display: grid;
    place-items: center;
    min-width: 32px;
    height: 32px;
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
    font-size: 15px;
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
    margin-bottom: 12px;
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
    margin-bottom: 14px;
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
    padding: 7px 14px;
    border-radius: 8px;
    opacity: 0.85;
    transition: opacity 0.2s;
  }

  .card:hover .cta { opacity: 1; }
</style>
