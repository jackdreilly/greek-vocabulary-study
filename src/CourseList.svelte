<script>
  import { ChevronRight, BookOpen, Volume2, Hash } from "lucide-svelte";

  export let courses = [];
  export let onOpenCourse = () => {};

  const COURSE_META = {
    "Afrodite Lourbakos": {
      description: "12 thematic units from the Lexilogio textbook — family, food, travel, body, and more.",
      emoji: "📖",
    },
    "Top 5000": {
      description: "The 5,000 most common Greek words, split into 20 bite-sized lessons with audio.",
      emoji: "📊",
    },
    "3rd Grade A1 Certification": {
      description: "Vocabulary sets from your daughter's 3rd-grade Greek storybooks and lessons.",
      emoji: "🎒",
    },
    "Every Day Greek": {
      description: "20 real-life lessons built around what actually comes up at home — feelings, food, family, and Greek expressions.",
      emoji: "🏡",
    },
  };

  const COURSE_COLORS = {
    "Afrodite Lourbakos":         { bg: "#fff8f0", border: "#f3d3b2", accent: "#c2621c", pill: "#fdebd0", grad: "linear-gradient(135deg, #fff3e3 0%, #fde8c8 100%)" },
    "Top 5000":                   { bg: "#f0f4ff", border: "#c5d4f5", accent: "#2952b3", pill: "#dce7ff", grad: "linear-gradient(135deg, #edf2ff 0%, #d4e0ff 100%)" },
    "3rd Grade A1 Certification": { bg: "#f3fff5", border: "#b8eac4", accent: "#1a7a40", pill: "#d2f5dc", grad: "linear-gradient(135deg, #edfff2 0%, #ccf5d8 100%)" },
    "Every Day Greek":            { bg: "#fdf3ff", border: "#ddb5f0", accent: "#7a1a8e", pill: "#f0d5ff", grad: "linear-gradient(135deg, #faf0ff 0%, #f0d8ff 100%)" },
  };

  function totalWords(c) { return c.lessons.reduce((s, l) => s + (l.entry_count ?? 0), 0); }
  function totalAudio(c) { return c.lessons.reduce((s, l) => s + (l.audio_count ?? 0), 0); }
</script>

<div class="course-list">
  <header class="hero">
    <h1 class="hero-title">Fanari Go</h1>
    <p class="hero-sub">Choose a course and start where you left off.</p>
  </header>

  <div class="grid">
    {#each courses as course}
      {@const colors = COURSE_COLORS[course.name] ?? { bg: "#f7f8fb", border: "#d9dee7", accent: "#444", pill: "#e5e8ef", grad: "#f7f8fb" }}
      {@const meta = COURSE_META[course.name] ?? { description: "", emoji: "📚" }}
      <button
        class="card"
        style="--bg:{colors.bg}; --border:{colors.border}; --accent:{colors.accent}; --pill:{colors.pill}; --grad:{colors.grad}"
        on:click={() => onOpenCourse(course.name)}
      >
        <div class="card-banner">
          <span class="card-emoji">{meta.emoji}</span>
        </div>

        <div class="card-body">
          <h2 class="card-title">{course.name}</h2>
          <p class="card-desc">{meta.description}</p>

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

  .hero {
    margin-bottom: 40px;
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
