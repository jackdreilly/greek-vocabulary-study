<script>
  import { tick } from "svelte";
  import { marked } from "marked";
  import {
    BookOpen,
    BotMessageSquare,
    ChevronDown,
    Languages,
    Maximize2,
    Minimize2,
    PenLine,
    Send,
    ShieldCheck,
    Sparkles,
    Trash2,
    Type,
    X,
  } from "lucide-svelte";
  import { streamYiayiaMessage } from "./lib/aiGames";

  export let lesson = null;
  export let exercise = null;
  export let entries = [];
  export let contextLabel = "";
  export let contextWords = [];
  export let contextType = null;

  const typeIcons = {
    missing_word: PenLine,
    reading_comprehension: BookOpen,
    story_prompt: Sparkles,
    sentence_translation: Languages,
    word_translation: Type,
  };

  let open = false;
  let expanded = false;
  let chatInput = "";
  let chatPending = false;
  let chatMessages = [];
  let streamingText = "";
  let chatScrollEl = null;
  let wordMode = false;
  let wordInput = "";
  let pendingTemplate = null;
  let chatModeOpen = false;
  let responseLanguage = localStorage.getItem("greekflash:ai-response-language") || "english";
  let cefrLevel = localStorage.getItem("greekflash:ai-cefr-level") || "A2";
  let aiModel = localStorage.getItem("greekflash:ai-model") || "lite";
  let adminMode = localStorage.getItem("greekflash:yiayia-admin-mode") === "1";

  $: preferences = { responseLanguage, cefrLevel, aiModel };
  $: localStorage.setItem("greekflash:ai-response-language", responseLanguage);
  $: localStorage.setItem("greekflash:ai-cefr-level", cefrLevel);
  $: localStorage.setItem("greekflash:ai-model", aiModel);
  $: localStorage.setItem("greekflash:yiayia-admin-mode", adminMode ? "1" : "0");

  const yiayiaModes = [
    {
      id: "explore",
      label: "Explore",
      prompt: () => [
        "Explore the current lesson context.",
        "Explain useful Greek patterns and give one or two nearby examples from the lesson area.",
        "Keep it concise and learner-facing.",
      ].join("\n\n"),
    },
    {
      id: "word",
      label: "Word",
      prompt: (word) => [
        `Word Architect: **${word}**`,
        "Break down this Greek word: core meaning, useful forms, related Greek words, English cognates or durable root connections, and one practical example sentence.",
        "Avoid silly mnemonic wordplay. Use markdown headings or a compact table when helpful.",
      ].join("\n\n"),
    },
    {
      id: "drill",
      label: "Drill",
      prompt: () => [
        "Create a quick active-recall drill from the current lesson vocabulary.",
        "Include 4 short prompts mixing fill-in-the-blank, translate a chunk, and word recognition. Put answers under a clear **Answer Key** heading.",
      ].join("\n\n"),
    },
  ];

  function renderMd(text) {
    return marked.parse(String(text || ""), { async: false });
  }

  function scrollChatToBottom() {
    if (!chatScrollEl) return;
    chatScrollEl.scrollTop = chatScrollEl.scrollHeight;
  }

  function selectYiayiaMode(modeId) {
    chatModeOpen = false;
    if (modeId === "word") {
      wordMode = true;
      wordInput = "";
      return;
    }
    const mode = yiayiaModes.find((item) => item.id === modeId);
    if (!mode) return;
    pendingTemplate = { label: mode.label, prompt: mode.prompt() };
  }

  function submitWordMode(word = wordInput) {
    const trimmed = word.trim();
    if (!trimmed) return;
    const mode = yiayiaModes.find((item) => item.id === "word");
    wordMode = false;
    wordInput = "";
    pendingTemplate = { label: `Word: ${trimmed}`, prompt: mode.prompt(trimmed) };
  }

  async function askYiayia() {
    const content = chatInput.trim();
    if ((!content && !pendingTemplate) || chatPending) return;
    const requestContent = [pendingTemplate?.prompt, content].filter(Boolean).join("\n\n");
    const nextMessages = [
      ...chatMessages,
      {
        role: "user",
        content,
        requestContent,
        templateLabel: pendingTemplate?.label || "",
      },
    ];
    chatMessages = nextMessages;
    chatInput = "";
    pendingTemplate = null;
    chatPending = true;
    streamingText = "";
    try {
      const reply = await streamYiayiaMessage({
        lesson,
        exercise,
        entries,
        messages: nextMessages,
        preferences,
        adminMode,
        onChunk: async (text) => {
          streamingText = text;
          await tick();
          scrollChatToBottom();
        },
      });
      chatMessages = [...nextMessages, { role: "assistant", content: reply }];
      streamingText = "";
    } catch (error) {
      chatMessages = [
        ...nextMessages,
        { role: "assistant", content: error.message || "I could not answer just now." },
      ];
      streamingText = "";
    } finally {
      chatPending = false;
    }
  }

  function clearChat() {
    chatMessages = [];
    streamingText = "";
    pendingTemplate = null;
    wordMode = false;
  }

  function toggle() {
    open = !open;
    if (open) {
      queueMicrotask(scrollChatToBottom);
    }
  }
</script>

<!-- Floating trigger button -->
{#if !open}
  <button class="yiayia-fab" type="button" title="Ask YiaYia" on:click={toggle}>
    <BotMessageSquare size={22} />
  </button>
{/if}

<!-- Chat panel -->
{#if open}
  <div class="yiayia-panel {expanded ? 'expanded' : ''}">
    <div class="yiayia-header">
      <div class="yiayia-header-left">
        <BotMessageSquare size={16} />
        <span class="yiayia-title">YiaYia</span>
        {#if contextLabel}
          {#if contextType && typeIcons[contextType]}
            <span class="yiayia-context yiayia-context-type">
              <svelte:component this={typeIcons[contextType]} size={11} />
            </span>
          {/if}
          <span class="yiayia-context">{contextLabel}</span>
        {/if}
      </div>
      <div class="yiayia-header-right">
        <select class="yiayia-select" bind:value={responseLanguage} title="AI response language">
          <option value="english">EN</option>
          <option value="greek">GR</option>
        </select>
        <select class="yiayia-select" bind:value={cefrLevel} title="CEFR level">
          <option value="A1">A1</option>
          <option value="A2">A2</option>
          <option value="B1">B1</option>
          <option value="B2">B2</option>
          <option value="C1">C1</option>
        </select>
        <button
          class="yiayia-model-btn"
          class:flash={aiModel === 'flash'}
          type="button"
          title={aiModel === 'flash' ? 'Using Flash — click for Lite' : 'Using Lite — click for Flash'}
          on:click={() => aiModel = aiModel === 'lite' ? 'flash' : 'lite'}
        >{aiModel === 'flash' ? '⚡' : '·'}</button>
        <button
          class="yiayia-admin-btn"
          class:active={adminMode}
          type="button"
          title={adminMode ? "Admin tools enabled" : "Enable admin tools"}
          aria-pressed={adminMode}
          on:click={() => adminMode = !adminMode}
        >
          <ShieldCheck size={13} />
        </button>
        {#if chatMessages.length}
          <button class="yiayia-icon-btn" type="button" title="Clear chat" on:click={clearChat}>
            <Trash2 size={14} />
          </button>
        {/if}
        <button class="yiayia-icon-btn" type="button" title={expanded ? "Minimize" : "Expand"} on:click={() => expanded = !expanded}>
          {#if expanded}<Minimize2 size={14} />{:else}<Maximize2 size={14} />{/if}
        </button>
        <button class="yiayia-icon-btn" type="button" title="Close" on:click={toggle}>
          <X size={14} />
        </button>
      </div>
    </div>

    <div class="yiayia-messages" bind:this={chatScrollEl}>
      {#if !chatMessages.length}
        <div class="yiayia-empty">
          Ask about vocabulary, a lesson word, or use Explore / Word / Drill modes.
          {#if adminMode}<strong> Admin mode is on.</strong>{/if}
        </div>
      {/if}
      {#each chatMessages as message}
        <div class="yiayia-msg {message.role}">
          {#if message.role === "assistant"}
            <div class="markdown-body">{@html renderMd(message.content)}</div>
          {:else}
            {#if message.templateLabel}
              <span class="yiayia-chip">{message.templateLabel}</span>
            {/if}
            {#if message.content}
              <div>{message.content}</div>
            {/if}
          {/if}
        </div>
      {/each}
      {#if chatPending && streamingText}
        <div class="yiayia-msg assistant">
          <div class="markdown-body">{@html renderMd(streamingText)}<span class="animate-pulse">▍</span></div>
        </div>
      {:else if chatPending}
        <div class="yiayia-msg assistant thinking">YiaYia is thinking...</div>
      {/if}
    </div>

    <div class="yiayia-input-area">
      {#if wordMode}
        <div class="yiayia-word-mode">
          <div class="yiayia-word-header">
            <span>Word Architect</span>
            <button type="button" on:click={() => (wordMode = false)}>Cancel</button>
          </div>
          {#if contextWords.length}
            <div class="yiayia-word-chips">
              {#each contextWords as word}
                <button class="yiayia-word-chip" type="button" on:click={() => submitWordMode(word)}>{word}</button>
              {/each}
            </div>
          {/if}
          <div class="yiayia-word-row">
            <input class="yiayia-text-input" bind:value={wordInput} placeholder="Or type any Greek word..." on:keydown={(e) => e.key === "Enter" && submitWordMode()} />
            <button class="yiayia-send-btn" type="button" disabled={!wordInput.trim()} on:click={() => submitWordMode()}>
              <Send size={14} />
            </button>
          </div>
        </div>
      {:else}
        <div class="yiayia-mode-row">
          <div class="yiayia-mode-wrap">
            {#if chatModeOpen}
              <div class="yiayia-mode-menu">
                {#each yiayiaModes as mode}
                  <button type="button" on:click={() => selectYiayiaMode(mode.id)}>{mode.label}</button>
                {/each}
              </div>
            {/if}
            <button class="yiayia-explore-btn" type="button" on:click={() => (chatModeOpen = !chatModeOpen)}>
              <Sparkles size={13} />
              Explore
              <ChevronDown size={12} />
            </button>
          </div>
        </div>
      {/if}

      {#if pendingTemplate && !wordMode}
        <div class="yiayia-pending">
          <Sparkles size={12} />
          <span>{pendingTemplate.label}</span>
          <button type="button" on:click={() => (pendingTemplate = null)}>×</button>
        </div>
      {/if}

      <div class="yiayia-compose">
        <input
          class="yiayia-text-input"
          bind:value={chatInput}
          placeholder={pendingTemplate ? "Add a note, or send..." : "Ask YiaYia..."}
          on:keydown={(e) => e.key === "Enter" && askYiayia()}
        />
        <button class="yiayia-send-btn" type="button" disabled={chatPending || (!chatInput.trim() && !pendingTemplate)} on:click={askYiayia}>
          <Send size={14} />
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* FAB */
  .yiayia-fab {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 900;
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    border: none;
    background: #17614f;
    color: #fff;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(23,97,79,0.35), 0 0 0 3px rgba(23,97,79,0.1);
    transition: all 0.2s;
  }
  .yiayia-fab:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(23,97,79,0.4); }

  /* Panel */
  .yiayia-panel {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 950;
    display: flex;
    flex-direction: column;
    width: 380px;
    max-width: calc(100vw - 40px);
    height: 520px;
    max-height: calc(100vh - 40px);
    border-radius: 16px;
    border: 1px solid #e5e8ef;
    background: #fff;
    box-shadow: 0 8px 40px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04);
    overflow: hidden;
  }
  .yiayia-panel.expanded {
    width: 560px;
    height: 680px;
  }

  /* Header */
  .yiayia-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid #e5e8ef;
    background: #fafbfd;
    flex-shrink: 0;
  }
  .yiayia-header-left { display: flex; align-items: center; gap: 6px; color: #202124; flex: 1; min-width: 0; overflow: hidden; }
  .yiayia-title { font-size: 13px; font-weight: 800; flex-shrink: 0; }
  .yiayia-context { font-size: 10px; font-weight: 700; color: #667085; background: #f0f2f7; padding: 2px 7px; border-radius: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .yiayia-header-right { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }

  .yiayia-select {
    height: 26px;
    padding: 0 4px;
    border: 1px solid #e5e8ef;
    border-radius: 5px;
    background: #fff;
    font-size: 10px;
    font-weight: 700;
    color: #202124;
    outline: none;
    cursor: pointer;
  }
  .yiayia-icon-btn {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid #e5e8ef;
    background: #fff;
    color: #667085;
    cursor: pointer;
    transition: all 0.12s;
  }
  .yiayia-icon-btn:hover { color: #202124; border-color: #202124; }

  .yiayia-context-type {
    display: inline-flex; align-items: center;
    padding: 2px 6px; background: rgba(23,97,79,0.1); color: #17614f;
    border-radius: 4px;
  }

  .yiayia-word-chips { display: flex; flex-wrap: wrap; gap: 5px; padding: 6px 0 2px; }
  .yiayia-word-chip {
    padding: 4px 10px; border-radius: 6px; border: 1px solid #e5e8ef;
    background: #f0f4f3; color: #17614f; font-size: 13px; font-weight: 600;
    cursor: pointer; transition: all 0.12s;
  }
  .yiayia-word-chip:hover { background: #17614f; color: #fff; border-color: #17614f; }

  .yiayia-model-btn {
    width: 24px; height: 24px; border-radius: 6px;
    border: 1px solid #e5e8ef; background: transparent;
    font-size: 12px; color: #99a1b3; cursor: pointer;
    transition: all 0.12s; line-height: 1;
  }
  .yiayia-model-btn:hover { border-color: #99a1b3; }
  .yiayia-model-btn.flash { color: #a77716; border-color: #a77716; background: rgba(167,119,22,0.06); }
  .yiayia-admin-btn {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 1px solid #e5e8ef;
    background: #fff;
    color: #667085;
    cursor: pointer;
    transition: all 0.12s;
  }
  .yiayia-admin-btn:hover { border-color: #99a1b3; color: #202124; }
  .yiayia-admin-btn.active {
    color: #8a1f11;
    border-color: #c44733;
    background: #fff2ef;
  }

  /* Messages */
  .yiayia-messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .yiayia-empty {
    padding: 14px;
    border-radius: 10px;
    border: 1px solid #e5e8ef;
    background: #fafbfd;
    font-size: 13px;
    line-height: 1.5;
    color: #667085;
  }
  .yiayia-msg {
    padding: 10px 14px;
    border-radius: 12px;
    font-size: 13px;
    line-height: 1.55;
    max-width: 92%;
  }
  .yiayia-msg.user {
    align-self: flex-end;
    background: #17614f;
    color: #fff;
    border-bottom-right-radius: 4px;
  }
  .yiayia-msg.assistant {
    align-self: flex-start;
    background: #f7f8fb;
    color: #202124;
    border: 1px solid #e5e8ef;
    border-bottom-left-radius: 4px;
  }
  .yiayia-msg.thinking { color: #667085; }
  .yiayia-chip {
    display: inline-flex;
    padding: 2px 8px;
    border-radius: 5px;
    background: rgba(255,255,255,0.15);
    font-size: 11px;
    font-weight: 700;
    margin-bottom: 4px;
  }

  /* Input area */
  .yiayia-input-area {
    border-top: 1px solid #e5e8ef;
    padding: 10px 12px;
    background: #fafbfd;
    flex-shrink: 0;
  }

  .yiayia-mode-row { margin-bottom: 8px; }
  .yiayia-mode-wrap { position: relative; display: inline-block; }
  .yiayia-mode-menu {
    position: absolute;
    bottom: 36px;
    left: 0;
    z-index: 10;
    display: grid;
    gap: 2px;
    width: 180px;
    padding: 6px;
    border-radius: 10px;
    border: 1px solid #e5e8ef;
    background: #fff;
    box-shadow: 0 4px 16px rgba(0,0,0,0.1);
  }
  .yiayia-mode-menu button {
    padding: 8px 12px;
    border: none;
    border-radius: 6px;
    background: transparent;
    font-size: 13px;
    font-weight: 700;
    color: #202124;
    text-align: left;
    cursor: pointer;
  }
  .yiayia-mode-menu button:hover { background: #f7f8fb; }

  .yiayia-explore-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 30px;
    padding: 0 10px;
    border-radius: 7px;
    border: 1px solid #e5e8ef;
    background: #fff;
    font-size: 11px;
    font-weight: 700;
    color: #202124;
    cursor: pointer;
    transition: all 0.12s;
  }
  .yiayia-explore-btn:hover { border-color: #17614f; color: #17614f; }

  .yiayia-word-mode {
    margin-bottom: 8px;
    padding: 8px;
    border-radius: 8px;
    border: 1px solid #e5e8ef;
    background: #fff;
  }
  .yiayia-word-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    font-weight: 700;
    color: #667085;
    margin-bottom: 6px;
  }
  .yiayia-word-header button { border: none; background: none; font-size: 11px; font-weight: 700; color: #202124; cursor: pointer; }
  .yiayia-word-row { display: flex; gap: 6px; }

  .yiayia-pending {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    margin-bottom: 8px;
    border-radius: 6px;
    border: 1px solid rgba(23,97,79,0.2);
    background: rgba(23,97,79,0.06);
    font-size: 11px;
    font-weight: 700;
    color: #17614f;
  }
  .yiayia-pending button { border: none; background: none; color: #17614f; font-size: 14px; font-weight: 700; cursor: pointer; padding: 0; margin-left: 2px; }

  .yiayia-compose { display: flex; gap: 6px; }
  .yiayia-text-input {
    flex: 1;
    height: 34px;
    padding: 0 10px;
    border: 1px solid #e5e8ef;
    border-radius: 8px;
    background: #fff;
    font-size: 13px;
    color: #202124;
    outline: none;
    transition: border-color 0.12s;
  }
  .yiayia-text-input:focus { border-color: #087985; }
  .yiayia-text-input::placeholder { color: rgba(102,112,133,0.6); }

  .yiayia-send-btn {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 8px;
    border: 1px solid #e5e8ef;
    background: #fff;
    color: #202124;
    cursor: pointer;
    transition: all 0.12s;
    flex-shrink: 0;
  }
  .yiayia-send-btn:hover { border-color: #17614f; color: #17614f; }
  .yiayia-send-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  /* Markdown inside chat */
  :global(.yiayia-panel .markdown-body) { display: grid; gap: 0.5rem; }
  :global(.yiayia-panel .markdown-body p) { margin: 0; }
  :global(.yiayia-panel .markdown-body ul),
  :global(.yiayia-panel .markdown-body ol) { margin: 0; padding-left: 1.2rem; }
  :global(.yiayia-panel .markdown-body li + li) { margin-top: 0.2rem; }
  :global(.yiayia-panel .markdown-body h1),
  :global(.yiayia-panel .markdown-body h2),
  :global(.yiayia-panel .markdown-body h3) { margin: 0.2rem 0 0; font-size: 0.88rem; font-weight: 800; color: #202124; }
  :global(.yiayia-panel .markdown-body table) { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
  :global(.yiayia-panel .markdown-body th),
  :global(.yiayia-panel .markdown-body td) { border: 1px solid #d9dee7; padding: 0.3rem 0.4rem; text-align: left; }
  :global(.yiayia-panel .markdown-body code) { border-radius: 0.2rem; background: #f0f2f7; padding: 0.06rem 0.2rem; }

  @media (max-width: 480px) {
    .yiayia-panel { bottom: 0; right: 0; width: 100vw; max-width: 100vw; height: 100vh; max-height: 100vh; border-radius: 0; }
    .yiayia-panel.expanded { width: 100vw; height: 100vh; }
  }
</style>
