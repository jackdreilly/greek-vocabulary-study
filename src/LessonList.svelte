<script>
  import { ChevronRight, Search } from "lucide-svelte";
  
  export let lessons = [];
  export let onOpenLesson = () => {};
  
  let search = "";
  
  const normalise = (value) =>
    String(value ?? "")
      .toLocaleLowerCase("el")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");

  function lessonProgress(lesson) {
    if (!lesson?.entry_count) return 0;
    return Math.round((lesson.translated_count / lesson.entry_count) * 100);
  }
  
  $: filteredLessons = lessons.filter((l) => normalise(l.title).includes(normalise(search)));
</script>

<div class="lesson-list-container">
  <header class="list-header">
    <div class="header-content">
      <h1 class="title">Choose your next lesson</h1>
      <p class="subtitle">Pick a set, do a quick round, and keep the words moving.</p>
    </div>
    
    <div class="search-box">
      <Search class="search-icon" size={18} />
      <input
        type="search"
        bind:value={search}
        placeholder="Find a lesson..."
        class="search-input"
      />
    </div>
  </header>

  <div class="lessons-grid">
    {#each filteredLessons as lesson}
      <button
        class="lesson-card"
        on:click={() => onOpenLesson(lesson.id)}
      >
        <div class="card-top">
          <div class="lesson-id">{lesson.id}</div>
          <h2 class="lesson-title">{lesson.title}</h2>
          <ChevronRight class="arrow-icon" size={20} />
        </div>
        
        <div class="progress-bar">
          <div class="progress-fill" style="width: {lessonProgress(lesson)}%"></div>
        </div>
        
        <div class="stats-row">
          <span class="badge">{lesson.entry_count.toLocaleString()} words</span>
          <span class="badge">{lesson.translated_count.toLocaleString()} meanings</span>
          {#if lesson.audio_count}
            <span class="badge">{lesson.audio_count.toLocaleString()} audio</span>
          {/if}
        </div>
        
        <div class="card-footer">
          <span class="start-btn">
            Start Lesson
            <ChevronRight size={16} />
          </span>
        </div>
      </button>
    {/each}
  </div>
</div>

<style>
  .lesson-list-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 40px 24px;
  }

  .list-header {
    display: flex;
    flex-direction: column;
    gap: 24px;
    margin-bottom: 40px;
  }

  @media (min-width: 768px) {
    .list-header {
      flex-direction: row;
      align-items: flex-end;
      justify-content: space-between;
    }
  }

  .title {
    font-size: 32px;
    font-weight: 800;
    color: #202124;
    margin: 0 0 8px 0;
    letter-spacing: -0.02em;
  }

  .subtitle {
    font-size: 16px;
    color: #667085;
    margin: 0;
  }

  .search-box {
    position: relative;
    width: 100%;
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
    height: 48px;
    padding: 0 16px 0 44px;
    border-radius: 12px;
    border: 1px solid #d9dee7;
    background: #fff;
    font-size: 15px;
    transition: all 0.2s;
    box-shadow: 0 2px 4px rgba(0,0,0,0.02);
  }

  .search-input:focus {
    outline: none;
    border-color: #17614f;
    box-shadow: 0 0 0 4px rgba(23, 97, 79, 0.1);
  }

  .lessons-grid {
    display: grid;
    gap: 24px;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  }

  .lesson-card {
    display: flex;
    flex-direction: column;
    padding: 24px;
    border-radius: 16px;
    border: 1px solid #d9dee7;
    background: #fff;
    text-align: left;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  }

  .lesson-card:hover {
    transform: translateY(-4px);
    border-color: #17614f;
    box-shadow: 0 12px 24px rgba(23, 97, 79, 0.1);
  }

  .card-top {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 20px;
  }

  .lesson-id {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: #f0f4f3;
    color: #17614f;
    font-size: 16px;
    font-weight: 800;
    flex-shrink: 0;
  }

  .lesson-title {
    flex: 1;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.3;
    color: #202124;
    margin: 0;
  }

  .arrow-icon {
    color: #d9dee7;
    transition: transform 0.3s, color 0.3s;
  }

  .lesson-card:hover .arrow-icon {
    color: #17614f;
    transform: translateX(4px);
  }

  .progress-bar {
    height: 6px;
    background: #f0f2f7;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 16px;
  }

  .progress-fill {
    height: 100%;
    background: #17614f;
    border-radius: 3px;
  }

  .stats-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 24px;
  }

  .badge {
    font-size: 12px;
    font-weight: 600;
    color: #667085;
    background: #f7f8fb;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid #e5e8ef;
  }

  .card-footer {
    margin-top: auto;
  }

  .start-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border-radius: 10px;
    background: #17614f;
    color: #fff;
    font-size: 14px;
    font-weight: 700;
    transition: all 0.2s;
  }

  .lesson-card:hover .start-btn {
    background: #124a3c;
    box-shadow: 0 4px 12px rgba(23, 97, 79, 0.2);
  }
</style>
