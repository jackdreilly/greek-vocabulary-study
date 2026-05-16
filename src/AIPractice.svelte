<script>
  import {
    BookOpen,
    Check,
    ChevronLeft,
    ChevronRight,
    Edit2,
    Languages,
    LoaderCircle,
    PenLine,
    Plus,
    RefreshCw,
    Save,
    Shuffle,
    Sparkles,
    Trash2,
    Type,
    X,
  } from "lucide-svelte";
  import {
    gameTypes,
    gameTypeLabels,
    generateLessonExercises,
    loadLessonExercises,
    removeLessonExercise,
    saveLessonExercise,
    scoreExerciseAnswer,
    seedLessonFourExercises,
    shuffleIds,
  } from "./lib/aiGames";

  export let lesson;
  export let entries = [];
  export let onExerciseChange = () => {};

  let exercises = [];
  let activeType = "missing_word";
  let order = [];
  let cursor = 0;
  let answerText = "";
  let scoreResult = null;
  let loading = false;
  let generating = false;
  let generateError = "";
  let submitPending = false;
  let editing = null;
  let responseLanguage = localStorage.getItem("greekflash:ai-response-language") || "english";
  let cefrLevel = localStorage.getItem("greekflash:ai-cefr-level") || "A2";

  $: preferences = { responseLanguage, cefrLevel };
  $: localStorage.setItem("greekflash:ai-response-language", responseLanguage);
  $: localStorage.setItem("greekflash:ai-cefr-level", cefrLevel);

  $: typeExercises = exercises.filter((e) => e.type === activeType);
  $: if (typeExercises.length && !order.length) order = shuffleIds(typeExercises);
  $: if (order.length && cursor >= order.length) cursor = 0;
  $: currentExercise = order.length ? typeExercises.find((e) => e.id === order[cursor]) || typeExercises[0] : null;
  $: currentIndex = currentExercise ? Math.max(0, order.indexOf(currentExercise.id)) : 0;
  $: onExerciseChange(currentExercise);

  const typeIcons = {
    missing_word: PenLine,
    reading_comprehension: BookOpen,
    story_prompt: Sparkles,
    sentence_translation: Languages,
    word_translation: Type,
  };

  const IMAGE_TYPES = new Set(["word_translation", "missing_word"]);
  $: exerciseImage = (() => {
    if (!currentExercise || !IMAGE_TYPES.has(currentExercise.type)) return null;
    const ids = currentExercise.sourceEntryIds || [];
    if (ids.length > 2) return null; // only show for word-specific exercises
    for (const id of ids) {
      const entry = entries.find(e => String(e.id) === String(id));
      if (entry?.image?.url || entry?.image?.thumbnail) return entry.image;
    }
    return null;
  })();

  async function loadExercises() {
    if (!lesson?.id) return;
    loading = true;
    generateError = "";
    try {
      const remote = await loadLessonExercises(lesson.id);
      exercises = remote.length || Number(lesson.id) !== 4 ? remote : seedLessonFourExercises();
      resetRound();
    } catch (error) {
      console.error("Could not load AI exercises:", error);
      exercises = Number(lesson.id) === 4 ? seedLessonFourExercises() : [];
      generateError = Number(lesson.id) === 4 ? "" : error.message;
    } finally {
      loading = false;
    }
  }

  $: if (lesson?.id) { loadExercises(); }

  function resetRound() {
    order = shuffleIds(exercises.filter((e) => e.type === activeType));
    cursor = 0;
    answerText = "";
    scoreResult = null;
  }

  function setType(type) { activeType = type; resetRound(); }

  function advanceExercise() {
    answerText = "";
    scoreResult = null;
    if (!order.length) return;
    if (cursor < order.length - 1) cursor += 1;
    else order = shuffleIds(typeExercises);
    if (cursor >= order.length) cursor = 0;
  }

  function previousExercise() {
    answerText = "";
    scoreResult = null;
    if (!order.length) return;
    if (cursor > 0) cursor -= 1;
    else cursor = Math.max(order.length - 1, 0);
  }

  function verdictLabel(r) {
    if (!r) return "";
    if (r.verdict === "correct") return "Correct";
    if (r.verdict === "almost") return "Close";
    return "Not quite";
  }

  function verdictEmoji(r) {
    if (!r) return "";
    if (r.verdict === "correct") return "✓";
    if (r.verdict === "almost") return "~";
    return "✗";
  }

  async function submitAnswer() {
    if (!currentExercise || !answerText.trim()) return;
    submitPending = true;
    try {
      scoreResult = await scoreExerciseAnswer({ lesson, exercise: currentExercise, answer: answerText, preferences });
    } catch (error) {
      scoreResult = {
        accepted: false, score: 0, verdict: "incorrect",
        feedback: error.message || "Could not score that answer.",
        betterAnswer: currentExercise.expectedAnswer,
        shortReason: "Scoring failed", greekCorrection: null,
      };
    } finally { submitPending = false; }
  }

  function handleAnswerKeydown(event) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (scoreResult) advanceExercise();
    else submitAnswer();
  }

  async function generateMore() {
    if (!lesson?.id || generating) return;
    generating = true;
    generateError = "";
    try {
      const generated = await generateLessonExercises({ lesson, entries, countPerType: 5, previousExercises: exercises, preferences });
      for (const exercise of generated) await saveLessonExercise(exercise);
      exercises = [...generated, ...exercises];
      resetRound();
    } catch (error) {
      console.error("Could not generate AI games:", error);
      generateError = error.message || "Could not generate more games.";
    } finally { generating = false; }
  }

  function openEditor(exercise = null) {
    editing = exercise
      ? JSON.parse(JSON.stringify(exercise))
      : { id: `l${lesson.id}-${activeType}-${Date.now()}`, lessonId: lesson.id, type: activeType, title: gameTypeLabels[activeType] || "Practice", prompt: "", instructions: "", expectedAnswer: "", acceptableAnswers: [], requiredWords: [], vocabulary: [], sourceEntryIds: [], direction: "free_response", rubric: "", status: "active", generatedBy: "manual" };
  }

  async function saveEditing() {
    if (!editing) return;
    const saved = await saveLessonExercise({ ...editing, lessonId: lesson.id, acceptableAnswers: normalizeList(editing.acceptableAnswers), requiredWords: normalizeList(editing.requiredWords), sourceEntryIds: normalizeList(editing.sourceEntryIds), createdInFirestore: true });
    const exists = exercises.some((e) => e.id === saved.id);
    exercises = exists ? exercises.map((e) => (e.id === saved.id ? saved : e)) : [saved, ...exercises];
    editing = null;
    resetRound();
  }

  async function removeExercise(exercise) {
    await removeLessonExercise(exercise);
    exercises = exercises.filter((item) => item.id !== exercise.id);
    resetRound();
  }

  function normalizeList(value) {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    return String(value || "").split(/\n|,/).map((item) => item.trim()).filter(Boolean);
  }
</script>

<div class="ai-page">
  <!-- Type tabs + actions bar -->
  <div class="ai-bar">
    <div class="ai-tabs">
      {#each gameTypes as type}
        <button
          class="ai-tab {activeType === type.id ? 'active' : ''}"
          type="button"
          on:click={() => setType(type.id)}
        >
          <svelte:component this={typeIcons[type.id]} size={12} />
          {type.short}
        </button>
      {/each}
    </div>
    <div class="ai-actions">
      <button class="ai-act-btn" type="button" title="Shuffle" on:click={resetRound}><Shuffle size={14} /></button>
      <button class="ai-act-btn" type="button" title="Add" on:click={() => openEditor()}><Plus size={14} /></button>
      <button class="ai-gen-btn" type="button" disabled={generating} on:click={generateMore}>
        {#if generating}<LoaderCircle class="animate-spin" size={14} />{:else}<RefreshCw size={14} />{/if}
        Generate
      </button>
    </div>
  </div>

  {#if generateError}
    <div class="ai-error">{generateError}</div>
  {/if}

  <!-- Exercise content - fills remaining space -->
  <div class="ai-body">
    {#if loading}
      <div class="ai-empty">Loading AI games...</div>
    {:else if currentExercise}
      <div class="ai-exercise">
        <!-- Question section -->
        <div class="ai-question-area">
          <div class="ai-question-top">
            <div class="ai-counter-group">
              <span class="ai-type-badge">
                <svelte:component this={typeIcons[currentExercise.type]} size={11} />
                {gameTypeLabels[currentExercise.type] || currentExercise.type}
              </span>
              <span class="ai-counter">{currentIndex + 1} / {typeExercises.length}</span>
            </div>
            <div class="ai-edit-actions">
              <button class="ai-icon-btn" type="button" title="Edit" on:click={() => openEditor(currentExercise)}><Edit2 size={13} /></button>
            </div>
          </div>

          {#if currentExercise.passage}
            <div class="ai-passage">{currentExercise.passage}</div>
          {/if}

          <p class="ai-prompt">{currentExercise.question || currentExercise.prompt}</p>

          {#if exerciseImage && !scoreResult}
            <img
              class="ai-exercise-img"
              src={exerciseImage.url || exerciseImage.thumbnail}
              style={`object-position: ${exerciseImage.position || 'center'}`}
              alt=""
              loading="lazy"
              decoding="async"
            />
          {/if}
        </div>

        <!-- Answer section -->
        <div class="ai-answer-area">
          {#if currentExercise.instructions && !scoreResult}
            <p class="ai-instruction">{currentExercise.instructions}</p>
          {/if}
          <textarea
            class="ai-input"
            bind:value={answerText}
            placeholder="Your answer..."
            on:keydown={handleAnswerKeydown}
            disabled={submitPending}
          ></textarea>

          {#if scoreResult}
            <div class="ai-result {scoreResult.verdict}">
              <div class="ai-result-header">
                <span class="ai-verdict-icon">{verdictEmoji(scoreResult)}</span>
                <span class="ai-verdict-label">{verdictLabel(scoreResult)}</span>
                <span class="ai-verdict-score">{Math.round(scoreResult.score * 100)}%</span>
              </div>
              <p class="ai-feedback">{scoreResult.feedback}</p>
              <p class="ai-target"><strong>Target:</strong> {scoreResult.betterAnswer || currentExercise.expectedAnswer}</p>
              {#if scoreResult.greekCorrection?.tips?.length}
                <div class="ai-coaching">
                  <p class="ai-coaching-text">{scoreResult.greekCorrection.correctedText}</p>
                  <ul>
                    {#each scoreResult.greekCorrection.tips as tip}
                      <li>{tip.original} → {tip.corrected}: {tip.explanation}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Nav bar pinned to bottom -->
        <div class="ai-nav">
          <button class="ai-nav-btn" type="button" on:click={previousExercise}><ChevronLeft size={18} /></button>
          <button class="ai-nav-btn skip" type="button" on:click={advanceExercise}>Skip</button>
          {#if scoreResult}
            <button class="ai-nav-btn primary" type="button" on:click={advanceExercise}>Next <ChevronRight size={16} /></button>
          {:else}
            <button
              class="ai-nav-btn primary"
              type="button"
              disabled={submitPending || !answerText.trim()}
              on:click={submitAnswer}
            >
              {#if submitPending}<LoaderCircle class="animate-spin" size={16} />{:else}<Check size={16} />{/if}
              Check
            </button>
          {/if}
          <button class="ai-nav-btn" type="button" on:click={advanceExercise}><ChevronRight size={18} /></button>
        </div>
      </div>
    {:else}
      <div class="ai-empty">
        <p>No AI games for this type yet.</p>
        <button class="ai-gen-btn" type="button" on:click={generateMore}>Generate games</button>
      </div>
    {/if}
  </div>
</div>

{#if editing}
  <div class="fixed inset-0 z-[120] grid place-items-center bg-ink/40 p-4">
    <div class="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-md border border-line bg-panel shadow-xl">
      <div class="flex items-center justify-between border-b border-line p-4">
        <h2 class="text-lg font-bold">Edit AI question</h2>
        <button class="icon-button h-8 w-8" type="button" on:click={() => (editing = null)}><X size={15} /></button>
      </div>
      <div class="grid max-h-[70vh] gap-3 overflow-y-auto p-4">
        <label class="grid gap-1 text-xs font-bold text-muted">Type
          <select class="control" bind:value={editing.type}>
            {#each gameTypes as type}<option value={type.id}>{type.label}</option>{/each}
          </select>
        </label>
        <label class="grid gap-1 text-xs font-bold text-muted">Title <input class="control" bind:value={editing.title} /></label>
        <label class="grid gap-1 text-xs font-bold text-muted">Instructions <input class="control" bind:value={editing.instructions} /></label>
        <label class="grid gap-1 text-xs font-bold text-muted">Prompt <textarea class="control min-h-24 py-2" bind:value={editing.prompt}></textarea></label>
        <label class="grid gap-1 text-xs font-bold text-muted">Passage <textarea class="control min-h-24 py-2" bind:value={editing.passage}></textarea></label>
        <label class="grid gap-1 text-xs font-bold text-muted">Question <input class="control" bind:value={editing.question} /></label>
        <label class="grid gap-1 text-xs font-bold text-muted">Expected answer <textarea class="control min-h-20 py-2" bind:value={editing.expectedAnswer}></textarea></label>
        <label class="grid gap-1 text-xs font-bold text-muted">Acceptable answers <textarea class="control min-h-20 py-2" bind:value={editing.acceptableAnswers}></textarea></label>
        <label class="grid gap-1 text-xs font-bold text-muted">Required words <textarea class="control min-h-20 py-2" bind:value={editing.requiredWords}></textarea></label>
        <label class="grid gap-1 text-xs font-bold text-muted">Rubric <textarea class="control min-h-20 py-2" bind:value={editing.rubric}></textarea></label>
      </div>
      <div class="flex justify-between gap-2 border-t border-line bg-paper p-4">
        <button class="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-100" type="button" on:click={async () => { if (editing?.id && exercises.some(e => e.id === editing.id)) { await removeExercise(exercises.find(e => e.id === editing.id)); } editing = null; }}><Trash2 size={14} /> Delete</button>
        <div class="flex gap-2">
          <button class="rounded-md border border-line bg-panel px-4 py-2 text-sm font-bold text-muted" type="button" on:click={() => (editing = null)}>Cancel</button>
          <button class="inline-flex items-center gap-2 rounded-md bg-green px-4 py-2 text-sm font-bold text-white" type="button" on:click={saveEditing}><Save size={15} /> Save</button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .ai-page {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* Top bar */
  .ai-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid #e5e8ef;
    background: #fff;
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .ai-tabs { display: flex; gap: 2px; overflow-x: auto; }
  .ai-tab {
    height: 30px; padding: 0 10px; border-radius: 6px; border: none;
    background: transparent; font-size: 11px; font-weight: 700; color: #667085;
    cursor: pointer; white-space: nowrap; transition: all 0.12s;
    display: inline-flex; align-items: center; gap: 5px;
  }
  .ai-tab:hover { background: #f0f2f7; color: #202124; }
  .ai-tab.active { background: #17614f; color: #fff; }
  .ai-actions { display: flex; align-items: center; gap: 5px; }
  .ai-act-btn {
    display: grid; place-items: center; width: 30px; height: 30px;
    border-radius: 6px; border: 1px solid #e5e8ef; background: #fff;
    color: #667085; cursor: pointer; transition: all 0.12s;
  }
  .ai-act-btn:hover { color: #17614f; border-color: #17614f; }
  .ai-gen-btn {
    display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 12px;
    border-radius: 6px; border: none; background: #17614f; font-size: 11px;
    font-weight: 700; color: #fff; cursor: pointer; transition: background 0.12s;
  }
  .ai-gen-btn:hover { background: #124a3c; }
  .ai-gen-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .ai-error {
    padding: 6px 16px; background: rgba(162,79,63,0.08); font-size: 12px;
    font-weight: 600; color: #a24f3f; flex-shrink: 0;
  }

  /* Body fills remaining space */
  .ai-body { flex: 1; display: flex; overflow: hidden; }

  .ai-exercise {
    flex: 1; display: flex; flex-direction: column;
    max-width: 800px; width: 100%; margin: 0 auto;
  }

  /* Question area - centered, prominent */
  .ai-question-area {
    flex: 1; display: flex; flex-direction: column;
    justify-content: center; align-items: center;
    padding: 24px 24px 12px; text-align: center;
    min-height: 0; overflow-y: auto;
  }
  .ai-question-top {
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; max-width: 600px; margin-bottom: 12px;
  }
  .ai-counter-group { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
  .ai-type-badge {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10px; font-weight: 700; color: #17614f;
    background: rgba(23,97,79,0.08); padding: 2px 8px;
    border-radius: 4px; letter-spacing: 0.02em;
  }
  .ai-counter { font-size: 11px; font-weight: 700; color: #99a1b3; }
  .ai-edit-actions { display: flex; gap: 4px; opacity: 0.3; transition: opacity 0.15s; }
  .ai-question-area:hover .ai-edit-actions { opacity: 1; }
  .ai-icon-btn {
    display: grid; place-items: center; width: 26px; height: 26px;
    border-radius: 5px; border: 1px solid #e5e8ef; background: #fff;
    color: #667085; cursor: pointer; transition: all 0.12s;
  }
  .ai-icon-btn:hover { color: #202124; border-color: #202124; }

  .ai-exercise-img {
    width: 100%;
    max-width: 320px;
    aspect-ratio: 16/10;
    border-radius: 10px;
    border: 1px solid #e5e8ef;
    object-fit: cover;
    margin-top: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    opacity: 0.9;
  }

  .ai-passage {
    width: 100%; max-width: 600px; margin-bottom: 16px; padding: 16px;
    border-radius: 10px; border: 1px solid #e5e8ef; background: #fafbfd;
    font-size: 15px; line-height: 1.75; color: #202124; text-align: left;
  }
  .ai-prompt {
    margin: 0 0 8px; max-width: 600px;
    font-size: clamp(1.25rem, 3vw, 1.75rem); font-weight: 800;
    line-height: 1.35; color: #202124; white-space: pre-wrap;
  }
  .ai-instruction {
    margin: 0 0 6px; font-size: 11px; font-weight: 700;
    color: #99a1b3; letter-spacing: 0.03em; text-transform: uppercase;
  }

  /* Answer area - bottom portion */
  .ai-answer-area {
    flex-shrink: 0; padding: 0 24px 8px;
    max-width: 800px; width: 100%; margin: 0 auto;
  }
  .ai-input {
    display: block; width: 100%; min-height: 80px; max-height: 140px;
    padding: 12px 14px; border-radius: 10px; border: 1px solid #e5e8ef;
    background: #fafbfd; font-size: 15px; color: #202124; outline: none;
    resize: none; transition: border-color 0.15s; font-family: inherit;
  }
  .ai-input:focus { border-color: #087985; }
  .ai-input::placeholder { color: rgba(102,112,133,0.5); }

  /* Result card */
  .ai-result {
    margin-top: 8px; padding: 12px 14px; border-radius: 10px; border: 1px solid;
    font-size: 13px; line-height: 1.55;
  }
  .ai-result.correct { border-color: #17614f; background: rgba(23,97,79,0.05); }
  .ai-result.almost { border-color: #a77716; background: rgba(167,119,22,0.05); }
  .ai-result.incorrect { border-color: #a24f3f; background: rgba(162,79,63,0.05); }
  .ai-result-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .ai-verdict-icon { font-size: 16px; font-weight: 800; }
  .ai-verdict-label { font-size: 14px; font-weight: 800; }
  .ai-verdict-score { margin-left: auto; font-size: 13px; font-weight: 700; color: #667085; }
  .ai-feedback { margin: 0; color: #202124; }
  .ai-target { margin: 6px 0 0; font-size: 12px; color: #667085; }
  .ai-coaching { margin-top: 8px; padding: 10px; border-radius: 8px; background: #f0f2f7; }
  .ai-coaching-text { margin: 0 0 4px; }
  .ai-coaching ul { margin: 4px 0 0; padding-left: 18px; color: #667085; }

  /* Nav bar */
  .ai-nav {
    display: flex; align-items: center; justify-content: center;
    gap: 8px; padding: 10px 16px; border-top: 1px solid #e5e8ef;
    background: #fff; flex-shrink: 0;
  }
  .ai-nav-btn {
    display: inline-flex; align-items: center; gap: 4px;
    height: 38px; padding: 0 14px; border-radius: 8px;
    border: 1px solid #e5e8ef; background: #fff;
    font-size: 13px; font-weight: 700; color: #202124;
    cursor: pointer; transition: all 0.12s;
  }
  .ai-nav-btn:hover { border-color: #17614f; color: #17614f; }
  .ai-nav-btn.skip { color: #667085; }
  .ai-nav-btn.primary {
    border: none; background: #17614f; color: #fff;
    box-shadow: 0 1px 6px rgba(23,97,79,0.2);
  }
  .ai-nav-btn.primary:hover { background: #124a3c; }
  .ai-nav-btn.primary:disabled { opacity: 0.45; cursor: not-allowed; }

  .ai-empty {
    flex: 1; display: grid; place-items: center; padding: 24px;
    text-align: center; font-size: 14px; font-weight: 600; color: #667085;
  }
</style>
