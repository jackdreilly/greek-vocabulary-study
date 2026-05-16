<script>
  import {
    ArrowLeft,
    BookOpen,
    Check,
    ChevronRight,
    Eye,
    EyeOff,
    GraduationCap,
    History,
    Languages,
    Lightbulb,
    LoaderCircle,
    MessageSquare,
    Plus,
    RefreshCw,
    Sparkles,
    Trash2,
    Wand2,
    X,
  } from "lucide-svelte";
  import { marked } from "marked";
  import {
    generateLessonPlan,
    loadLessonPlans,
    removeLessonPlan,
    saveLessonPlan,
  } from "./lib/aiPlans";

  export let lesson;
  export let entries = [];

  let plans = [];
  let selectedPlanId = null;
  let viewMode = 'home'; // 'home' | 'plan'
  let customPrompt = '';
  let loading = false;
  let generating = false;
  let errorMessage = "";

  // Per-widget interaction state, namespaced by `${planId}::${widgetIndex}`
  let widgetState = {};
  // Per-mini_quiz: { selected: number[], checked: boolean[] }
  // Per-fill_in_blanks: { answers: string[], checked: boolean[] }
  // Per-conjugation_table: { practiceMode: boolean, revealed: Set<string> }
  // Per-reading_passage: { showTranslation: boolean }

  let responseLanguage = localStorage.getItem("greekflash:ai-response-language") || "english";
  let cefrLevel = localStorage.getItem("greekflash:ai-cefr-level") || "A2";
  $: preferences = { responseLanguage, cefrLevel };

  $: selectedPlan = plans.find((p) => p.id === selectedPlanId) || plans[plans.length - 1] || null;
  $: nextPlanNumber = (plans.reduce((max, p) => Math.max(max, p.planNumber || 0), 0) || 0) + 1;

  async function loadPlans() {
    if (!lesson?.id) return;
    loading = true;
    errorMessage = "";
    try {
      plans = await loadLessonPlans(lesson.id);
      if (plans.length && !plans.find((p) => p.id === selectedPlanId)) {
        selectedPlanId = plans[plans.length - 1].id;
      }
    } catch (e) {
      console.error("Could not load plans", e);
      errorMessage = e.message || "Could not load plans.";
    } finally {
      loading = false;
    }
  }

  async function generateNextPlan(customFocus = '') {
    if (!lesson?.id || generating) return;
    generating = true;
    errorMessage = "";
    try {
      const plan = await generateLessonPlan({ lesson, entries, previousPlans: plans, preferences, customFocus });
      const saved = await saveLessonPlan(plan);
      plans = [...plans, saved];
      selectedPlanId = saved.id;
      viewMode = 'plan';
      customPrompt = '';
    } catch (e) {
      console.error("Could not generate plan", e);
      errorMessage = e.message || "Could not generate plan.";
    } finally {
      generating = false;
    }
  }

  function gotoPlan(id) {
    selectedPlanId = id;
    viewMode = 'plan';
  }

  async function deletePlan(plan) {
    if (!confirm(`Delete Plan #${plan.planNumber}: "${plan.title}"? This cannot be undone.`)) return;
    try {
      await removeLessonPlan(plan);
      plans = plans.filter((p) => p.id !== plan.id);
      if (selectedPlanId === plan.id) {
        selectedPlanId = plans.length ? plans[plans.length - 1].id : null;
      }
    } catch (e) {
      console.error("Could not delete plan", e);
      errorMessage = e.message || "Could not delete plan.";
    }
  }

  $: if (lesson?.id) {
    selectedPlanId = null;
    viewMode = 'home';
    plans = [];
    loadPlans();
  }

  function renderInlineMarkdown(text) {
    return marked.parseInline(String(text || ""), { async: false });
  }

  function renderProse(text) {
    return marked.parse(String(text || ""), { async: false });
  }

  function widgetKey(planId, index) {
    return `${planId}::${index}`;
  }

  function updateWState(key, patch) {
    widgetState = { ...widgetState, [key]: { ...(widgetState[key] || {}), ...patch } };
  }

  function selectQuizOption(key, qIndex, optionIndex, total) {
    const state = widgetState[key] || { selected: Array(total).fill(-1), checked: Array(total).fill(false) };
    if (state.checked?.[qIndex]) return;
    const selected = [...(state.selected || Array(total).fill(-1))];
    selected[qIndex] = optionIndex;
    updateWState(key, { selected, checked: state.checked || Array(total).fill(false) });
  }

  function checkQuizQuestion(key, qIndex, total) {
    const state = widgetState[key] || { selected: Array(total).fill(-1), checked: Array(total).fill(false) };
    const checked = [...(state.checked || Array(total).fill(false))];
    checked[qIndex] = true;
    updateWState(key, { checked });
  }

  function normalizeAns(text) {
    return String(text || "")
      .toLocaleLowerCase("el")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/['’]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function checkBlank(key, idx, expected, total) {
    const state = widgetState[key] || { answers: Array(total).fill(""), checked: Array(total).fill(false), correct: Array(total).fill(false) };
    const answers = [...(state.answers || Array(total).fill(""))];
    const checked = [...(state.checked || Array(total).fill(false))];
    const correct = [...(state.correct || Array(total).fill(false))];
    checked[idx] = true;
    correct[idx] = normalizeAns(answers[idx]) === normalizeAns(expected);
    updateWState(key, { answers, checked, correct });
  }

  function setBlankValue(key, idx, value, total) {
    const state = widgetState[key] || { answers: Array(total).fill(""), checked: Array(total).fill(false), correct: Array(total).fill(false) };
    const answers = [...(state.answers || Array(total).fill(""))];
    answers[idx] = value;
    updateWState(key, { answers });
  }

  function toggleConjugationPractice(key) {
    const state = widgetState[key] || { practiceMode: false, revealed: {} };
    updateWState(key, { practiceMode: !state.practiceMode, revealed: {} });
  }

  function revealCell(key, rowIdx, colIdx) {
    const state = widgetState[key] || { practiceMode: false, revealed: {} };
    const revealed = { ...(state.revealed || {}) };
    revealed[`${rowIdx}-${colIdx}`] = true;
    updateWState(key, { revealed });
  }

  function toggleTranslation(key) {
    const state = widgetState[key] || { showTranslation: false };
    updateWState(key, { showTranslation: !state.showTranslation });
  }

  const calloutIcons = {
    pattern: Sparkles,
    history: History,
    etymology: BookOpen,
    tip: Lightbulb,
    cultural: GraduationCap,
    mnemonic: Wand2,
  };

  function calloutLabel(kind) {
    return ({
      pattern: "Pattern",
      history: "Historical context",
      etymology: "Etymology",
      tip: "Tip",
      cultural: "Cultural note",
      mnemonic: "Memory hook",
    })[kind] || "Note";
  }
</script>

<div class="plans-page">
  <div class="plans-toolbar">
    {#if viewMode === 'plan' && selectedPlan}
      <button class="back-to-home" type="button" on:click={() => viewMode = 'home'}>
        <ArrowLeft size={14} /> All Plans
      </button>
      <span class="current-plan-label">{selectedPlan.title}</span>
    {:else}
      <span class="toolbar-heading">Plans</span>
    {/if}
    <div class="plan-actions">
      <button class="plan-refresh" type="button" title="Reload" on:click={loadPlans} disabled={loading || generating}>
        <RefreshCw size={14} />
      </button>
    </div>
  </div>

  {#if errorMessage}
    <div class="plan-error">{errorMessage}</div>
  {/if}

  {#if viewMode === 'home'}
    <div class="plans-scroll">
      {#if loading && !plans.length}
        <div class="plan-empty">
          <LoaderCircle class="animate-spin" size={28} />
          <p>Loading plans…</p>
        </div>
      {:else}
        <div class="home-view">
          {#if plans.length}
            <div class="plans-grid">
              {#each plans as p}
                <div class="plan-card" role="button" tabindex="0" on:click={() => gotoPlan(p.id)} on:keydown={(e) => e.key === 'Enter' && gotoPlan(p.id)}>
                  <div class="card-eyebrow">
                    <span>Plan #{p.planNumber}</span>
                    {#if p.estimatedMinutes}<span class="dot">·</span><span>{p.estimatedMinutes} min</span>{/if}
                    {#if p.coveredWords?.length}<span class="dot">·</span><span>{p.coveredWords.length} words</span>{/if}
                  </div>
                  <div class="card-title">{p.title}</div>
                  {#if p.subtitle}<div class="card-subtitle">{p.subtitle}</div>{/if}
                  {#if p.coveredConcepts?.length}
                    <div class="card-chips">
                      {#each p.coveredConcepts.slice(0, 4) as concept}
                        <span class="chip">{concept}</span>
                      {/each}
                    </div>
                  {/if}
                  <button
                    type="button"
                    class="card-delete"
                    title="Delete plan"
                    on:click|stopPropagation={() => deletePlan(p)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              {/each}
            </div>
          {:else}
            <div class="plan-empty inline">
              <GraduationCap size={36} />
              <h2>No plans yet</h2>
              <p>Generate a structured, textbook-style module from this lesson's vocabulary.</p>
              <p class="muted">Each plan covers a focused angle — a theme, a grammar pattern, a verb family — with reading, tables, quizzes, and more.</p>
            </div>
          {/if}

          <div class="generate-section">
            <div class="generate-row">
              <input
                class="generate-input"
                type="text"
                placeholder="Optional: describe a focus area, e.g. 'verb conjugations' or 'food vocabulary'…"
                bind:value={customPrompt}
                maxlength={5000}
                on:keydown={(e) => { if (e.key === 'Enter' && !generating && customPrompt.length <= 5000) generateNextPlan(customPrompt); }}
                disabled={generating}
              />
              <button
                class="plan-gen-btn"
                type="button"
                disabled={generating || loading || !lesson || customPrompt.length > 5000}
                on:click={() => generateNextPlan(customPrompt)}
              >
                {#if generating}
                  <LoaderCircle class="animate-spin" size={14} />
                  Generating…
                {:else}
                  <Wand2 size={14} />
                  Generate Plan #{nextPlanNumber}
                {/if}
              </button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <!-- Plan detail view -->
    <div class="plans-scroll">
      {#if selectedPlan}
      <article class="plan-doc">
        <header class="plan-header">
          <div class="plan-eyebrow">
            <span>Plan #{selectedPlan.planNumber}</span>
            {#if selectedPlan.estimatedMinutes}
              <span class="dot">·</span>
              <span>{selectedPlan.estimatedMinutes} min</span>
            {/if}
            {#if selectedPlan.coveredWords?.length}
              <span class="dot">·</span>
              <span>{selectedPlan.coveredWords.length} words</span>
            {/if}
          </div>
          <h1 class="plan-title">{selectedPlan.title}</h1>
          {#if selectedPlan.subtitle}
            <p class="plan-subtitle">{selectedPlan.subtitle}</p>
          {/if}
          {#if selectedPlan.coveredConcepts?.length}
            <div class="concept-chips">
              {#each selectedPlan.coveredConcepts as concept}
                <span class="chip">{concept}</span>
              {/each}
            </div>
          {/if}
        </header>

        <div class="widgets">
          {#each selectedPlan.widgets as widget, wi (wi)}
            {@const key = widgetKey(selectedPlan.id, wi)}

            {#if widget.type === 'heading'}
              {#if widget.level === 1}
                <h2 class="w-heading w-h1">{widget.text || ''}</h2>
              {:else if widget.level === 3}
                <h4 class="w-heading w-h3">{widget.text || ''}</h4>
              {:else}
                <h3 class="w-heading w-h2">{widget.text || ''}</h3>
              {/if}

            {:else if widget.type === 'prose'}
              <div class="w-prose">{@html renderProse(widget.body || '')}</div>

            {:else if widget.type === 'callout'}
              <aside class="w-callout {widget.calloutKind || 'tip'}">
                <div class="callout-icon">
                  <svelte:component this={calloutIcons[widget.calloutKind] || Lightbulb} size={16} />
                </div>
                <div class="callout-body">
                  <div class="callout-kind">{calloutLabel(widget.calloutKind)}</div>
                  {#if widget.title}<div class="callout-title">{widget.title}</div>{/if}
                  <div class="callout-text">{@html renderInlineMarkdown(widget.body || '')}</div>
                </div>
              </aside>

            {:else if widget.type === 'vocab_table'}
              <section class="w-table-section">
                {#if widget.title}<h3 class="w-heading w-h2">{widget.title}</h3>{/if}
                <div class="vocab-table">
                  {#each (widget.vocabEntries || []) as v}
                    <div class="vocab-row">
                      <div class="vocab-greek">
                        {#if v.article}<span class="article">{v.article}</span>{/if}
                        <span class="lemma">{v.greek}</span>
                      </div>
                      <div class="vocab-english">{v.english}</div>
                      {#if v.example}<div class="vocab-example">{v.example}</div>{/if}
                    </div>
                  {/each}
                </div>
              </section>

            {:else if widget.type === 'conjugation_table' || widget.type === 'comparison_table'}
              {@const cstate = widgetState[key] ?? { practiceMode: false, revealed: {} }}
              <section class="w-table-section">
                <div class="table-head">
                  <div>
                    {#if widget.title}<h3 class="w-heading w-h2 inline">{widget.title}</h3>{/if}
                    {#if widget.lemma}<span class="lemma-badge">{widget.lemma}</span>{/if}
                    {#if widget.tense}<span class="lemma-badge alt">{widget.tense}</span>{/if}
                  </div>
                  {#if widget.type === 'conjugation_table'}
                    <button class="practice-toggle" type="button" on:click={() => toggleConjugationPractice(key)}>
                      {#if cstate.practiceMode}
                        <EyeOff size={13} /> Show all
                      {:else}
                        <Eye size={13} /> Practice mode
                      {/if}
                    </button>
                  {/if}
                </div>
                <div class="paradigm-table">
                  <div class="paradigm-row paradigm-header">
                    <div class="paradigm-label"></div>
                    {#each (widget.columns || []) as col}
                      <div class="paradigm-cell paradigm-col-head">{col}</div>
                    {/each}
                  </div>
                  {#each (widget.rows || []) as row, ri}
                    <div class="paradigm-row">
                      <div class="paradigm-label">{row.label}</div>
                      {#each (row.cells || []) as cell, ci}
                        {#if widget.type === 'conjugation_table' && cstate.practiceMode && !cstate.revealed?.[`${ri}-${ci}`]}
                          <button class="paradigm-cell hidden-cell" type="button" on:click={() => revealCell(key, ri, ci)}>
                            Reveal
                          </button>
                        {:else}
                          <div class="paradigm-cell">{cell}</div>
                        {/if}
                      {/each}
                    </div>
                  {/each}
                </div>
                {#if widget.notes}
                  <p class="table-notes">{@html renderInlineMarkdown(widget.notes)}</p>
                {/if}
              </section>

            {:else if widget.type === 'reading_passage'}
              {@const pstate = widgetState[key] ?? { showTranslation: false }}
              <section class="w-passage">
                <div class="passage-head">
                  {#if widget.title}<h3 class="w-heading w-h2 inline">{widget.title}</h3>{/if}
                  <button class="practice-toggle" type="button" on:click={() => toggleTranslation(key)}>
                    <Languages size={13} />
                    {pstate.showTranslation ? 'Hide translation' : 'Show translation'}
                  </button>
                </div>
                <div class="passage-greek">{widget.greek || ''}</div>
                {#if pstate.showTranslation && widget.english}
                  <div class="passage-english">{widget.english}</div>
                {/if}
                {#if widget.glossary?.length}
                  <div class="passage-glossary">
                    <div class="glossary-label">Glossary</div>
                    <div class="glossary-grid">
                      {#each widget.glossary as g}
                        <div class="glossary-row">
                          <span class="glossary-greek">{g.greek}</span>
                          <span class="glossary-arrow">→</span>
                          <span class="glossary-english">{g.english}</span>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}
              </section>

            {:else if widget.type === 'dialogue'}
              <section class="w-dialogue">
                {#if widget.title}<h3 class="w-heading w-h2">{widget.title}</h3>{/if}
                {#if widget.setting}<p class="dialogue-setting">{widget.setting}</p>{/if}
                <div class="dialogue-lines">
                  {#each (widget.lines || []) as line, li}
                    <div class="dialogue-line" class:alt={li % 2 === 1}>
                      <div class="dialogue-speaker">{line.speaker}</div>
                      <div class="dialogue-bubble">
                        <div class="dialogue-greek">{line.greek}</div>
                        {#if line.english}<div class="dialogue-english">{line.english}</div>{/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </section>

            {:else if widget.type === 'mini_quiz'}
              {@const total = (widget.questions || []).length}
              {@const qstate = widgetState[key] ?? { selected: Array(total).fill(-1), checked: Array(total).fill(false) }}
              <section class="w-quiz">
                <div class="quiz-head">
                  <MessageSquare size={16} />
                  <h3 class="w-heading w-h2 inline">{widget.title || 'Quick check'}</h3>
                </div>
                <div class="quiz-questions">
                  {#each (widget.questions || []) as q, qi}
                    <div class="quiz-q">
                      <div class="quiz-prompt">{qi + 1}. {q.question}</div>
                      <div class="quiz-options">
                        {#each (q.options || []) as opt, oi}
                          {@const selected = qstate.selected?.[qi] === oi}
                          {@const checked = qstate.checked?.[qi]}
                          {@const isCorrect = oi === q.answerIndex}
                          <button
                            type="button"
                            class="quiz-option"
                            class:selected
                            class:correct={checked && isCorrect}
                            class:wrong={checked && selected && !isCorrect}
                            disabled={checked}
                            on:click={() => selectQuizOption(key, qi, oi, total)}
                          >
                            <span class="opt-letter">{String.fromCharCode(65 + oi)}</span>
                            <span class="opt-text">{opt}</span>
                            {#if checked && isCorrect}<Check size={14} />{/if}
                            {#if checked && selected && !isCorrect}<X size={14} />{/if}
                          </button>
                        {/each}
                      </div>
                      {#if !qstate.checked?.[qi]}
                        <button
                          type="button"
                          class="quiz-check"
                          disabled={(qstate.selected?.[qi] ?? -1) < 0}
                          on:click={() => checkQuizQuestion(key, qi, total)}
                        >Check</button>
                      {:else}
                        <div class="quiz-explanation">
                          {#if qstate.selected?.[qi] === q.answerIndex}
                            <span class="verdict ok"><Check size={13} /> Correct</span>
                          {:else}
                            <span class="verdict bad"><X size={13} /> Answer: {q.options[q.answerIndex]}</span>
                          {/if}
                          {#if q.explanation}<p class="explain-text">{q.explanation}</p>{/if}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </section>

            {:else if widget.type === 'fill_in_blanks'}
              {@const ftotal = (widget.blankItems || []).length}
              {@const fstate = widgetState[key] ?? { answers: Array(ftotal).fill(""), checked: Array(ftotal).fill(false), correct: Array(ftotal).fill(false) }}
              <section class="w-fill">
                <div class="quiz-head">
                  <Sparkles size={16} />
                  <h3 class="w-heading w-h2 inline">{widget.title || 'Fill the blanks'}</h3>
                </div>
                {#if widget.instructions}<p class="fill-instructions">{widget.instructions}</p>{/if}
                <div class="fill-items">
                  {#each (widget.blankItems || []) as item, fi}
                    {@const isChecked = fstate.checked?.[fi]}
                    {@const isCorrect = fstate.correct?.[fi]}
                    {@const parts = (item.sentence || '').split('___')}
                    <div class="fill-item">
                      <div class="fill-sentence">
                        {#each parts as part, pi}
                          <span>{part}</span>
                          {#if pi < parts.length - 1}
                            <input
                              class="fill-input"
                              class:correct={isChecked && isCorrect}
                              class:wrong={isChecked && !isCorrect}
                              value={fstate.answers?.[fi] || ""}
                              on:input={(e) => setBlankValue(key, fi, e.target.value, ftotal)}
                              on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); checkBlank(key, fi, item.answer, ftotal); } }}
                              disabled={isChecked && isCorrect}
                              placeholder="…"
                              autocomplete="off"
                              autocorrect="off"
                              spellcheck="false"
                            />
                          {/if}
                        {/each}
                      </div>
                      <div class="fill-actions">
                        {#if !isChecked || !isCorrect}
                          <button type="button" class="quiz-check" on:click={() => checkBlank(key, fi, item.answer, ftotal)}>Check</button>
                        {/if}
                        {#if isChecked}
                          {#if isCorrect}
                            <span class="verdict ok"><Check size={13} /> Correct</span>
                          {:else}
                            <span class="verdict bad"><X size={13} /> {item.answer}</span>
                          {/if}
                        {/if}
                        {#if item.english}<span class="fill-english">{item.english}</span>{/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </section>

            {:else if widget.type === 'word_tree'}
              <section class="w-tree">
                <div class="tree-root">
                  <div class="tree-root-greek">{widget.rootGreek || ''}</div>
                  <div class="tree-root-english">{widget.rootEnglish || ''}</div>
                  {#if widget.rootGloss}<div class="tree-root-gloss">{widget.rootGloss}</div>{/if}
                </div>
                <div class="tree-branches">
                  {#each (widget.branches || []) as b}
                    <div class="tree-branch">
                      <ChevronRight size={14} />
                      <div class="branch-body">
                        <div class="branch-line">
                          <span class="branch-greek">{b.greek}</span>
                          <span class="branch-english">{b.english}</span>
                        </div>
                        {#if b.relation}<div class="branch-relation">{b.relation}</div>{/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </section>
            {/if}
          {/each}
        </div>

        <footer class="plan-footer">
          <div class="footer-meta">
            <span>Plan #{selectedPlan.planNumber}</span>
            {#if selectedPlan.coveredWords?.length}
              <span class="dot">·</span>
              <span class="footer-words">{selectedPlan.coveredWords.slice(0, 12).join(', ')}{selectedPlan.coveredWords.length > 12 ? '…' : ''}</span>
            {/if}
          </div>
          <button class="plan-delete" type="button" on:click={() => deletePlan(selectedPlan)} title="Delete plan">
            <Trash2 size={13} /> Delete
          </button>
        </footer>
      </article>
      {/if}
    </div>
  {/if}
</div>

<style>
  .plans-page { display: flex; flex-direction: column; height: 100%; min-height: 0; }

  .plans-toolbar {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 20px; background: #fff;
    border-bottom: 1px solid #e5e8ef; flex-shrink: 0; min-height: 52px;
  }
  .toolbar-heading {
    font-size: 15px; font-weight: 800; color: #202124; flex: 1;
  }
  .back-to-home {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 6px 12px; border-radius: 8px;
    border: 1px solid #d9dee7; background: #f7f8fb;
    color: #475467; font-size: 12px; font-weight: 700; cursor: pointer;
    flex-shrink: 0;
  }
  .back-to-home:hover { background: #ebeef4; }
  .current-plan-label {
    flex: 1; font-size: 13px; font-weight: 700; color: #202124;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .plan-actions { display: flex; gap: 8px; flex-shrink: 0; margin-left: auto; }
  .plan-refresh {
    width: 32px; height: 32px; border-radius: 8px;
    border: 1px solid #d9dee7; background: #fff;
    display: grid; place-items: center; color: #667085; cursor: pointer;
  }
  .plan-refresh:disabled { opacity: 0.5; cursor: default; }
  .plan-gen-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 14px; border-radius: 8px; border: none;
    background: #17614f; color: #fff; font-weight: 700; font-size: 13px;
    cursor: pointer;
  }
  .plan-gen-btn:disabled { opacity: 0.6; cursor: wait; }
  .plan-gen-btn.big { padding: 12px 20px; font-size: 14px; }

  .plan-error {
    margin: 8px 20px; padding: 10px 14px; border-radius: 8px;
    background: #fde8e6; color: #a24f3f; font-size: 13px; font-weight: 600;
  }

  .plans-scroll { flex: 1; overflow-y: auto; background: #f7f8fb; }

  .plan-empty {
    height: 100%; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 12px;
    padding: 40px; text-align: center; color: #667085;
  }
  .plan-empty.inline { height: auto; padding: 40px 40px 0; }
  .plan-empty h2 { margin: 4px 0 0; color: #202124; font-size: 20px; }
  .plan-empty p { margin: 0; max-width: 460px; }
  .plan-empty p.muted { color: #99a1b3; font-size: 13px; }

  /* Home view */
  .home-view { display: flex; flex-direction: column; padding: 24px; gap: 24px; max-width: 1000px; margin: 0 auto; }

  .plans-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
  }

  .plan-card {
    position: relative;
    display: flex; flex-direction: column; gap: 8px;
    padding: 18px 18px 14px;
    background: #fff; border-radius: 14px;
    border: 1px solid #ebeef4;
    box-shadow: 0 1px 3px rgba(16,24,40,0.04);
    cursor: pointer; text-align: left;
    transition: box-shadow 0.15s, border-color 0.15s;
    font-family: Inter, sans-serif;
  }
  .plan-card:hover { border-color: #17614f; box-shadow: 0 4px 12px rgba(23,97,79,0.1); }

  .card-eyebrow {
    display: flex; align-items: center; gap: 5px;
    font-size: 11px; font-weight: 800; color: #99a1b3;
    text-transform: uppercase; letter-spacing: 0.07em;
  }
  .card-eyebrow .dot { opacity: 0.6; }
  .card-title {
    font-family: 'Georgia', serif; font-size: 17px; font-weight: 700;
    color: #17614f; line-height: 1.25; margin: 0;
  }
  .card-subtitle {
    font-size: 13px; color: #667085; font-style: italic;
    line-height: 1.4; margin: 0;
  }
  .card-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }

  .card-delete {
    position: absolute; top: 12px; right: 12px;
    width: 26px; height: 26px; border-radius: 6px;
    border: 1px solid transparent; background: transparent;
    color: #c1c8d4; cursor: pointer; display: grid; place-items: center;
    opacity: 0; transition: opacity 0.15s;
  }
  .plan-card:hover .card-delete { opacity: 1; }
  .card-delete:hover { background: #fde8e6; color: #a24f3f; border-color: #f4c5be; }

  /* Generate section */
  .generate-section {
    padding: 20px; background: #fff; border-radius: 14px;
    border: 1px solid #ebeef4;
  }
  .generate-row {
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
  }
  .generate-input {
    flex: 1; min-width: 200px;
    height: 40px; border-radius: 8px;
    border: 1px solid #d9dee7; padding: 0 14px;
    font-size: 13px; font-family: Inter, sans-serif; color: #202124;
    background: #f7f8fb; outline: none;
  }
  .generate-input:focus { border-color: #17614f; background: #fff; }
  .generate-input:disabled { opacity: 0.6; }

  /* === Plan document === */
  .plan-doc {
    max-width: 760px; margin: 24px auto 60px;
    padding: 40px 48px 56px;
    background: #fff; border-radius: 16px;
    box-shadow: 0 1px 3px rgba(16,24,40,0.04), 0 1px 2px rgba(16,24,40,0.06);
    border: 1px solid #ebeef4;
    font-family: 'Georgia', 'Source Serif Pro', serif;
    color: #1d2939;
    line-height: 1.65;
  }
  .plan-header { margin-bottom: 32px; border-bottom: 1px solid #ebeef4; padding-bottom: 20px; }
  .plan-eyebrow {
    display: flex; gap: 6px; font-family: Inter, sans-serif;
    font-size: 11px; font-weight: 800; color: #99a1b3;
    text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px;
  }
  .plan-eyebrow .dot { opacity: 0.6; }
  .plan-title {
    margin: 0 0 6px; font-size: 32px; line-height: 1.2;
    color: #17614f; font-weight: 700;
  }
  .plan-subtitle {
    margin: 0; font-size: 17px; color: #475467; font-style: italic;
  }
  .concept-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 14px; font-family: Inter, sans-serif; }
  .chip {
    padding: 3px 10px; border-radius: 999px;
    background: #f0f4f3; color: #17614f;
    font-size: 11px; font-weight: 700;
  }

  .widgets { display: flex; flex-direction: column; gap: 24px; }

  .w-heading { font-family: 'Georgia', serif; color: #17614f; font-weight: 700; margin: 8px 0; }
  .w-h1 { font-size: 24px; }
  .w-h2 { font-size: 20px; border-bottom: 1px solid #ebeef4; padding-bottom: 6px; }
  .w-h3 { font-size: 16px; color: #475467; }
  .w-heading.inline { border: none; padding: 0; margin: 0; }

  .w-prose :global(p) { margin: 0 0 12px; }
  .w-prose :global(p:last-child) { margin-bottom: 0; }
  .w-prose :global(strong) { color: #17614f; }
  .w-prose :global(em) { color: #475467; }
  .w-prose :global(ul) { margin: 0 0 12px; padding-left: 22px; }
  .w-prose :global(li) { margin: 4px 0; }

  /* Callout */
  .w-callout {
    display: flex; gap: 12px; padding: 14px 18px;
    border-radius: 10px; border-left: 4px solid #17614f;
    background: #f0f4f3; font-family: Inter, sans-serif; line-height: 1.55;
  }
  .w-callout.history { background: #fdf6e8; border-left-color: #b48a2b; }
  .w-callout.etymology { background: #f4ecf9; border-left-color: #7a4ea8; }
  .w-callout.tip { background: #ecf4ff; border-left-color: #2f6cd6; }
  .w-callout.cultural { background: #fcf0ea; border-left-color: #c4663e; }
  .w-callout.mnemonic { background: #f3f8e8; border-left-color: #6b8e1e; }
  .callout-icon { flex-shrink: 0; margin-top: 2px; }
  .w-callout.pattern .callout-icon { color: #17614f; }
  .w-callout.history .callout-icon { color: #b48a2b; }
  .w-callout.etymology .callout-icon { color: #7a4ea8; }
  .w-callout.tip .callout-icon { color: #2f6cd6; }
  .w-callout.cultural .callout-icon { color: #c4663e; }
  .w-callout.mnemonic .callout-icon { color: #6b8e1e; }
  .callout-kind { font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.7; }
  .callout-title { font-weight: 700; margin: 2px 0 4px; font-size: 15px; color: #1d2939; }
  .callout-text { font-size: 14px; color: #344054; }
  .callout-text :global(strong) { color: #17614f; }

  /* Tables */
  .w-table-section { font-family: Inter, sans-serif; }
  .table-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
  .lemma-badge {
    display: inline-block; margin-left: 8px;
    padding: 2px 10px; border-radius: 6px;
    background: #17614f; color: #fff;
    font-family: 'Georgia', serif; font-size: 15px; font-weight: 600;
    vertical-align: middle;
  }
  .lemma-badge.alt { background: #475467; }
  .practice-toggle {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 6px 10px; border-radius: 6px;
    border: 1px solid #d9dee7; background: #fff;
    color: #475467; font-size: 12px; font-weight: 700; cursor: pointer;
  }

  .vocab-table {
    display: grid; border: 1px solid #ebeef4; border-radius: 10px; overflow: hidden;
  }
  .vocab-row {
    display: grid; grid-template-columns: 200px 1fr auto;
    padding: 10px 14px; gap: 12px; border-bottom: 1px solid #ebeef4; align-items: baseline;
    font-size: 14px;
  }
  .vocab-row:last-child { border-bottom: none; }
  .vocab-row:nth-child(even) { background: #fafbfc; }
  .vocab-greek { font-family: 'Georgia', serif; font-size: 17px; color: #17614f; font-weight: 600; }
  .vocab-greek .article { color: #99a1b3; font-weight: 500; margin-right: 4px; }
  .vocab-english { color: #344054; }
  .vocab-example { color: #99a1b3; font-style: italic; font-family: 'Georgia', serif; font-size: 13px; }

  .paradigm-table {
    border: 1px solid #ebeef4; border-radius: 10px; overflow: hidden;
    font-family: Inter, sans-serif;
  }
  .paradigm-row { display: grid; grid-template-columns: 160px 1fr 1fr 1fr 1fr; border-bottom: 1px solid #ebeef4; }
  .paradigm-row:last-child { border-bottom: none; }
  .paradigm-row.paradigm-header { background: #f3f5f9; }
  .paradigm-row.paradigm-header .paradigm-cell { font-size: 11px; font-weight: 800; text-transform: uppercase; color: #667085; letter-spacing: 0.06em; }
  .paradigm-label {
    padding: 10px 14px; font-size: 12px; font-weight: 700; color: #475467;
    background: #fafbfc; border-right: 1px solid #ebeef4;
  }
  .paradigm-cell {
    padding: 10px 14px; font-family: 'Georgia', serif; font-size: 16px; color: #17614f;
    border-right: 1px solid #ebeef4;
  }
  .paradigm-cell:last-child { border-right: none; }
  .paradigm-cell.paradigm-col-head { color: #667085; }
  button.paradigm-cell.hidden-cell {
    background: #f0f4f3; border-style: dashed; border-color: #c5dbd3;
    color: #99a1b3; cursor: pointer; font-family: Inter, sans-serif; font-size: 12px;
    font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
  }
  button.paradigm-cell.hidden-cell:hover { background: #e2ece9; color: #17614f; }
  .table-notes { margin: 10px 0 0; font-size: 13px; color: #667085; font-family: Inter, sans-serif; }

  /* Passage */
  .w-passage { font-family: Inter, sans-serif; }
  .passage-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
  .passage-greek {
    padding: 18px 22px; border-radius: 10px;
    background: #fff8e8; border-left: 4px solid #c4923b;
    font-family: 'Georgia', serif; font-size: 17px; color: #1d2939; line-height: 1.75;
    white-space: pre-wrap;
  }
  .passage-english {
    margin-top: 10px; padding: 12px 18px;
    background: #f3f5f9; border-radius: 8px;
    font-size: 14px; color: #475467; line-height: 1.6;
  }
  .passage-glossary { margin-top: 12px; }
  .glossary-label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #99a1b3; margin-bottom: 6px; }
  .glossary-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 4px 16px; font-size: 13px; }
  .glossary-row { display: flex; gap: 6px; align-items: baseline; }
  .glossary-greek { font-family: 'Georgia', serif; color: #17614f; font-weight: 600; }
  .glossary-arrow { color: #99a1b3; }
  .glossary-english { color: #475467; }

  /* Dialogue */
  .w-dialogue { font-family: Inter, sans-serif; }
  .dialogue-setting { margin: 0 0 12px; font-style: italic; color: #667085; font-size: 13px; }
  .dialogue-lines { display: flex; flex-direction: column; gap: 8px; }
  .dialogue-line { display: grid; grid-template-columns: 110px 1fr; gap: 12px; align-items: start; }
  .dialogue-speaker { font-weight: 700; color: #17614f; font-size: 13px; padding-top: 8px; }
  .dialogue-bubble {
    padding: 10px 14px; background: #f3f5f9; border-radius: 12px 12px 12px 4px;
  }
  .dialogue-line.alt .dialogue-bubble { background: #ecf4f1; border-radius: 12px 12px 4px 12px; }
  .dialogue-greek { font-family: 'Georgia', serif; font-size: 16px; color: #1d2939; }
  .dialogue-english { margin-top: 4px; font-size: 12px; color: #667085; font-style: italic; }

  /* Quiz */
  .w-quiz, .w-fill {
    padding: 18px 22px; border-radius: 12px;
    background: #f7f8fb; border: 1px solid #ebeef4;
    font-family: Inter, sans-serif;
  }
  .quiz-head { display: flex; align-items: center; gap: 8px; color: #17614f; margin-bottom: 14px; }
  .quiz-questions, .fill-items { display: flex; flex-direction: column; gap: 18px; }
  .quiz-q { padding: 14px; border-radius: 10px; background: #fff; border: 1px solid #ebeef4; }
  .quiz-prompt { font-weight: 600; color: #1d2939; margin-bottom: 10px; font-size: 14px; }
  .quiz-options { display: flex; flex-direction: column; gap: 6px; }
  .quiz-option {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px; border-radius: 8px;
    border: 1px solid #d9dee7; background: #fff;
    text-align: left; cursor: pointer;
    font-family: inherit; color: #1d2939; font-size: 13px;
    transition: all 0.15s;
  }
  .quiz-option:hover:not(:disabled) { border-color: #17614f; background: #f0f4f3; }
  .quiz-option.selected { border-color: #17614f; background: #f0f4f3; }
  .quiz-option.correct { border-color: #2e7d4f; background: #e7f5ec; color: #1f5b3a; }
  .quiz-option.wrong { border-color: #c44e4e; background: #fbeae6; color: #8a2f2f; }
  .opt-letter {
    width: 22px; height: 22px; border-radius: 50%;
    background: #f3f5f9; color: #667085;
    display: grid; place-items: center; font-size: 11px; font-weight: 800;
    flex-shrink: 0;
  }
  .opt-text { flex: 1; }
  .quiz-option.correct .opt-letter { background: #2e7d4f; color: #fff; }
  .quiz-option.wrong .opt-letter { background: #c44e4e; color: #fff; }
  .quiz-check {
    margin-top: 10px; padding: 6px 14px; border-radius: 6px; border: none;
    background: #17614f; color: #fff; font-weight: 700; font-size: 12px; cursor: pointer;
  }
  .quiz-check:disabled { background: #c1c8d4; cursor: default; }
  .quiz-explanation { margin-top: 10px; padding: 10px 12px; background: #f0f4f3; border-radius: 6px; }
  .verdict { display: inline-flex; align-items: center; gap: 4px; font-weight: 700; font-size: 12px; }
  .verdict.ok { color: #2e7d4f; }
  .verdict.bad { color: #a24f3f; }
  .explain-text { margin: 6px 0 0; font-size: 13px; color: #475467; line-height: 1.5; }

  /* Fill */
  .fill-instructions { margin: -4px 0 14px; color: #475467; font-size: 13px; font-style: italic; }
  .fill-item { padding: 12px 14px; background: #fff; border-radius: 10px; border: 1px solid #ebeef4; }
  .fill-sentence { font-family: 'Georgia', serif; font-size: 16px; color: #1d2939; line-height: 1.8; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .fill-input {
    min-width: 100px; max-width: 200px;
    border: none; border-bottom: 2px solid #17614f;
    background: #f0f4f3; padding: 2px 8px; border-radius: 4px 4px 0 0;
    font-family: 'Georgia', serif; font-size: 16px; color: #17614f;
    outline: none;
  }
  .fill-input:focus { background: #e2ece9; }
  .fill-input.correct { background: #e7f5ec; border-bottom-color: #2e7d4f; color: #1f5b3a; }
  .fill-input.wrong { background: #fbeae6; border-bottom-color: #c44e4e; color: #8a2f2f; }
  .fill-actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; font-size: 12px; flex-wrap: wrap; }
  .fill-english { color: #99a1b3; font-style: italic; }

  /* Word tree */
  .w-tree {
    padding: 20px; border-radius: 12px;
    background: linear-gradient(135deg, #f0f4f3 0%, #f7f8fb 100%);
    border: 1px solid #ebeef4; font-family: Inter, sans-serif;
  }
  .tree-root { text-align: center; padding: 14px 16px; background: #fff; border-radius: 10px; border: 2px solid #17614f; max-width: 320px; margin: 0 auto 18px; }
  .tree-root-greek { font-family: 'Georgia', serif; font-size: 26px; color: #17614f; font-weight: 700; }
  .tree-root-english { font-size: 13px; color: #475467; margin-top: 2px; }
  .tree-root-gloss { margin-top: 6px; font-size: 12px; color: #99a1b3; font-style: italic; }
  .tree-branches { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
  .tree-branch { display: flex; gap: 8px; padding: 10px 12px; background: #fff; border-radius: 8px; border: 1px solid #ebeef4; }
  .tree-branch :global(svg) { color: #17614f; flex-shrink: 0; margin-top: 4px; }
  .branch-body { flex: 1; min-width: 0; }
  .branch-line { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
  .branch-greek { font-family: 'Georgia', serif; font-size: 15px; color: #17614f; font-weight: 600; }
  .branch-english { color: #475467; font-size: 13px; }
  .branch-relation { font-size: 11px; color: #99a1b3; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }

  /* Footer */
  .plan-footer { margin-top: 36px; padding-top: 18px; border-top: 1px solid #ebeef4; display: flex; justify-content: space-between; align-items: center; font-family: Inter, sans-serif; gap: 12px; flex-wrap: wrap; }
  .footer-meta { font-size: 11px; color: #99a1b3; display: flex; gap: 6px; flex-wrap: wrap; }
  .footer-words { font-family: 'Georgia', serif; color: #667085; font-style: italic; }
  .plan-delete {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 4px 10px; border-radius: 6px;
    border: 1px solid #ebeef4; background: #fff;
    color: #a24f3f; font-size: 11px; font-weight: 700; cursor: pointer;
  }
  .plan-delete:hover { background: #fde8e6; }

  @media (max-width: 720px) {
    .plan-doc { margin: 12px; padding: 24px 20px 40px; }
    .plan-title { font-size: 24px; }
    .vocab-row { grid-template-columns: 1fr; gap: 4px; }
    .paradigm-row { grid-template-columns: 100px repeat(auto-fit, minmax(80px, 1fr)); }
    .dialogue-line { grid-template-columns: 1fr; }
    .dialogue-speaker { padding-top: 0; }
  }
</style>
