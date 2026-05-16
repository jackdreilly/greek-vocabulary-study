<script>
  import { ChevronRight, BookOpen, Volume2, Hash, Sparkles } from "lucide-svelte";

  export let courses = [];
  export let onOpenCourse = () => {};
  export let onGenerateCourse = null;

  const COURSE_PALETTES = [
    { bg: "#fff8f0", border: "#f3d3b2", accent: "#a65318", pill: "#fdebd0", grad: "linear-gradient(135deg, #fff3e3 0%, #fde8c8 100%)" },
    { bg: "#f0f4ff", border: "#c5d4f5", accent: "#2952b3", pill: "#dce7ff", grad: "linear-gradient(135deg, #edf2ff 0%, #d4e0ff 100%)" },
    { bg: "#f3fff5", border: "#b8eac4", accent: "#1a7a40", pill: "#d2f5dc", grad: "linear-gradient(135deg, #edfff2 0%, #ccf5d8 100%)" },
    { bg: "#fff5f7", border: "#edbdc6", accent: "#a33f55", pill: "#f9dbe2", grad: "linear-gradient(135deg, #fff0f3 0%, #f8d8df 100%)" },
    { bg: "#f3fbff", border: "#b7ddea", accent: "#1f6e87", pill: "#d4edf5", grad: "linear-gradient(135deg, #edfaff 0%, #d4edf5 100%)" },
  ];

  function hashName(name) {
    return [...String(name || "")].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  }

  function courseColors(course) {
    return COURSE_PALETTES[hashName(course.name) % COURSE_PALETTES.length];
  }

  function totalWords(c) { return c.lessons.reduce((s, l) => s + (l.entry_count ?? 0), 0); }
  function totalAudio(c) { return c.lessons.reduce((s, l) => s + (l.audio_count ?? 0), 0); }
  function courseDescription(c) {
    if (c.description) return c.description;
    const lessonText = `${c.lessons.length} lesson${c.lessons.length !== 1 ? "s" : ""}`;
    return `${lessonText} ready to study.`;
  }
</script>

<div class="course-list">
  <header class="hero">
    <div class="hero-row">
      <div>
        <h1 class="hero-title">Fanari Go</h1>
        <p class="hero-sub">Choose a course and start where you left off.</p>
      </div>
      {#if onGenerateCourse}
        <button class="gen-course-btn" type="button" on:click={onGenerateCourse}>
          <Sparkles size={14} /> Generate Course
        </button>
      {/if}
    </div>
  </header>

  <div class="grid">
    {#each courses as course}
      {@const colors = courseColors(course)}
      <button
        class="card"
        style="--bg:{colors.bg}; --border:{colors.border}; --accent:{colors.accent}; --pill:{colors.pill}; --grad:{colors.grad}"
        on:click={() => onOpenCourse(course.id)}
      >
        <div class="card-banner">
          <BookOpen size={34} />
        </div>

        <div class="card-body">
          <h2 class="card-title">{course.name}</h2>
          <p class="card-desc">{courseDescription(course)}</p>

          <div class="stats">
            <span class="stat">
              <Hash size={13} />
              {course.lessons.length} lesson{course.lessons.length !== 1 ? "s" : ""}
            </span>
            <span class="stat">
              <BookOpen size={13} />
              {totalWords(course).toLocaleString()} words
            </span>
            {#if totalAudio(course) > 0}
              <span class="stat">
                <Volume2 size={13} />
                {totalAudio(course).toLocaleString()} audio
              </span>
            {/if}
          </div>
        </div>

        <div class="card-footer">
          <span class="cta">
            Open Course
            <ChevronRight size={15} />
          </span>
        </div>
      </button>
    {/each}
  </div>
</div>

<style>
  .course-list {
    max-width: 960px;
    margin: 0 auto;
    padding: 48px 24px 64px;
  }

  .hero { margin-bottom: 40px; }

  .hero-row {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  }

  .hero-title {
    font-size: 36px;
    font-weight: 900;
    color: #202124;
    margin: 0 0 8px;
    letter-spacing: -0.03em;
  }

  .hero-sub {
    font-size: 17px;
    color: #667085;
    margin: 0;
  }

  .gen-course-btn {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 10px 18px; border-radius: 12px; border: none;
    background: #17614f; color: #fff;
    font-size: 14px; font-weight: 700; cursor: pointer;
    opacity: 0.9; transition: opacity 0.2s, box-shadow 0.2s;
    white-space: nowrap; flex-shrink: 0;
  }
  .gen-course-btn:hover { opacity: 1; box-shadow: 0 4px 14px rgba(23,97,79,0.25); }

  .grid {
    display: grid;
    gap: 24px;
    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  }

  @media (max-width: 480px) {
    .grid { grid-template-columns: 1fr; }
  }

  .card {
    display: flex;
    flex-direction: column;
    border-radius: 20px;
    border: 1.5px solid var(--border);
    background: var(--bg);
    text-align: left;
    cursor: pointer;
    transition: transform 0.25s cubic-bezier(0.4,0,0.2,1), box-shadow 0.25s;
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    overflow: hidden;
  }

  .card:hover {
    transform: translateY(-5px);
    box-shadow: 0 16px 32px color-mix(in srgb, var(--accent) 12%, transparent);
    border-color: var(--accent);
  }

  .card-banner {
    background: var(--grad);
    height: 80px;
    display: grid;
    place-items: center;
    font-size: 40px;
  }

  .card-body {
    padding: 20px 22px 16px;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .card-title {
    font-size: 20px;
    font-weight: 800;
    color: #202124;
    margin: 0;
    letter-spacing: -0.01em;
  }

  .card-desc {
    font-size: 14px;
    color: #667085;
    line-height: 1.55;
    margin: 0;
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }

  .stat {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
    background: var(--pill);
    padding: 4px 10px;
    border-radius: 20px;
  }

  .card-footer {
    padding: 0 22px 20px;
  }

  .cta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--accent);
    color: #fff;
    font-size: 14px;
    font-weight: 700;
    padding: 10px 20px;
    border-radius: 10px;
    transition: opacity 0.2s;
    opacity: 0.88;
  }

  .card:hover .cta {
    opacity: 1;
    box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 25%, transparent);
  }
</style>
