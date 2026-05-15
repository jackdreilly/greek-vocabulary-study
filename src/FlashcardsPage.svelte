<script>
  import {
    ChevronLeft,
    ChevronRight,
    Edit2,
    Languages,
    LoaderCircle,
    RotateCcw,
    Shuffle,
    Volume2,
  } from "lucide-svelte";

  export let deck = [];
  export let cardIndex = 0;
  export let cardFlipped = false;
  export let cardMode = "gr-en";
  export let imageMode = "back";
  export let currentAudio = null;
  export let audioLoadingId = null;
  export let onMoveCard = () => {};
  export let onFlipCard = () => {};
  export let onShuffleDeck = () => {};
  export let onSetCardMode = () => {};
  export let onPlayAudio = () => {};
  export let onOpenEdit = () => {};
  export let onSetImageMode = () => {};

  const cardModes = [
    { value: "gr-en", label: "Greek to English", short: "GR → EN" },
    { value: "en-gr", label: "English to Greek", short: "EN → GR" },
    { value: "mixed", label: "Mixed", short: "Mixed" },
  ];

  let studyCardEl = null;
  let dragStart = null;
  let dragX = 0;
  let dragY = 0;
  let dragTransition = false;
  let suppressNextClick = false;
  let loadedImages = new Set();

  function preloadImage(src) {
    if (!src || loadedImages.has(src)) return;
    const img = new Image();
    img.onload = () => { loadedImages = new Set([...loadedImages, src]); };
    img.src = src;
    if (img.complete) loadedImages = new Set([...loadedImages, src]);
  }

  function getSenses(entry) {
    if (Array.isArray(entry.english_senses) && entry.english_senses.length) {
      return entry.english_senses;
    }
    return entry.english ? entry.english.split(/\s*;\s*/).filter(Boolean) : [];
  }

  function imageSrc(image) {
    return image?.url || image?.thumbnail || "";
  }

  function directionForCard(entry, index, mode) {
    let dir = mode;
    if (dir === "mixed") {
      dir = (entry.id + index) % 2 === 0 ? "gr-en" : "en-gr";
    }
    if (dir === "en-gr" && getSenses(entry).length === 0) {
      return "gr-en";
    }
    return dir;
  }

  function directionLabel(direction) {
    return direction === "en-gr" ? "English to Greek" : "Greek to English";
  }

  function resetDrag() {
    dragStart = null;
    dragX = 0;
    dragY = 0;
    dragTransition = false;
  }

  function handleCardPointerDown(event) {
    if (!currentCard || event.button !== 0 || event.target.closest("button")) return;
    dragTransition = false;
    dragStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    dragX = 0;
    dragY = 0;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleCardPointerMove(event) {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    dragX = event.clientX - dragStart.x;
    dragY = event.clientY - dragStart.y;
  }

  function handleCardPointerUp(event) {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    const absX = Math.abs(dragX);
    const absY = Math.abs(dragY);
    const swiped = absX > 90 && absX > absY * 1.15;
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    if (swiped) {
      suppressNextClick = true;
      dragTransition = true;
      dragX = dragX > 0 ? 360 : -360;
      dragY = Math.max(-80, Math.min(80, dragY));
      const delta = dragX < 0 ? 1 : -1;
      setTimeout(() => { onMoveCard(delta); resetDrag(); }, 120);
      return;
    }

    resetDrag();
    onFlipCard();
  }

  function handleCardPointerCancel() {
    dragTransition = true;
    dragX = 0;
    dragY = 0;
    dragStart = null;
    setTimeout(() => { dragTransition = false; }, 140);
  }

  $: currentCard = deck[cardIndex];
  $: currentDirection = currentCard ? directionForCard(currentCard, cardIndex, cardMode) : "gr-en";
  $: cardTransform = `translate(${dragX}px, ${dragY}px) rotate(${dragX / 28}deg)`;

  // Preload current card + next 2 cards' images
  $: {
    for (let i = 0; i <= 2; i++) {
      const card = deck[cardIndex + i];
      if (card?.image) preloadImage(imageSrc(card.image));
    }
  }
  $: currentImageSrc = currentCard?.image ? imageSrc(currentCard.image) : null;
  $: currentImageReady = !currentImageSrc || loadedImages.has(currentImageSrc);
</script>

<div class="flashcards-page">
  <!-- Top toolbar -->
  <div class="fc-toolbar">
    <div class="fc-toolbar-left">
      <div class="fc-counter">
        {#if deck.length}
          <span class="fc-counter-current">{cardIndex + 1}</span>
          <span class="fc-counter-sep">/</span>
          <span class="fc-counter-total">{deck.length.toLocaleString()}</span>
        {:else}
          <span class="fc-counter-total">No cards</span>
        {/if}
      </div>
    </div>

    <div class="fc-toolbar-center">
      <div class="fc-mode-switcher">
        {#each cardModes as mode}
          <button
            class="fc-mode-btn {cardMode === mode.value ? 'active' : ''}"
            type="button"
            on:click={() => onSetCardMode(mode.value)}
          >
            {mode.short}
          </button>
        {/each}
      </div>
    </div>

    <div class="fc-toolbar-right">
      <div class="fc-img-switcher">
        <span class="fc-img-label">IMG</span>
        {#each ['front', 'back', 'none'] as mode}
          <button
            class="fc-mode-btn small {imageMode === mode ? 'active' : ''}"
            type="button"
            on:click={() => onSetImageMode(mode)}
          >
            {mode === 'front' ? 'F' : mode === 'back' ? 'B' : '—'}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <!-- Progress bar -->
  {#if deck.length}
    <div class="fc-progress-track">
      <div class="fc-progress-fill" style={`width: ${((cardIndex + 1) / deck.length) * 100}%`}></div>
    </div>
  {/if}

  <!-- Card area -->
  <div class="fc-card-area">
    {#if currentCard}
      <article
        bind:this={studyCardEl}
        class="fc-card {cardFlipped ? 'flipped' : ''} {dragTransition ? 'transitioning' : ''}"
        style={`transform: ${cardTransform};`}
        role="button"
        tabindex={0}
        on:pointerdown={handleCardPointerDown}
        on:pointermove={handleCardPointerMove}
        on:pointerup={handleCardPointerUp}
        on:pointercancel={handleCardPointerCancel}
        on:keydown={() => {}}
        on:click={(event) => {
          if (suppressNextClick) { event.preventDefault(); suppressNextClick = false; }
        }}
      >
        <button
          class="fc-edit-btn"
          title="Edit word"
          on:click|stopPropagation={() => onOpenEdit(currentCard)}
        >
          <Edit2 size={14} />
        </button>

        <div class="fc-card-inner">
          <div class="fc-card-meta">
            {#if cardFlipped}
              <span class="fc-card-tag answer">Answer</span>
            {:else if cardMode === "mixed"}
              <span class="fc-card-tag">{currentDirection === "gr-en" ? "GR → EN" : "EN → GR"}</span>
            {/if}
          </div>

          {#if currentCard.image && imageMode !== "none" && ((imageMode === "front" && !cardFlipped) || (imageMode === "back" && cardFlipped))}
            <figure class="fc-card-figure">
              {#if currentImageReady}
                <img
                  class="fc-card-img"
                  style={`object-position: ${currentCard.image.position || 'center'};`}
                  src={currentImageSrc}
                  alt=""
                  decoding="async"
                />
              {:else}
                <div class="fc-img-loading">
                  <LoaderCircle class="animate-spin" size={28} />
                </div>
              {/if}
            </figure>
          {/if}

          {#if currentDirection === "gr-en"}
            {#if cardFlipped}
              <ol class="fc-senses">
                {#each getSenses(currentCard) as sense}
                  <li>{sense}</li>
                {/each}
              </ol>
              <span class="fc-card-sub">{currentCard.lemma}</span>
            {:else}
              <strong class="fc-card-word">{currentCard.lemma}</strong>
              <span class="fc-card-hint">tap to flip</span>
            {/if}
          {:else}
            {#if cardFlipped}
              <strong class="fc-card-word">{currentCard.lemma}</strong>
            {:else}
              <ol class="fc-senses">
                {#each getSenses(currentCard) as sense}
                  <li>{sense}</li>
                {/each}
              </ol>
              <span class="fc-card-hint">tap to flip</span>
            {/if}
          {/if}

          {#if currentCard.audio_path && (currentDirection === "gr-en" || cardFlipped)}
            <button
              class="fc-audio-btn"
              type="button"
              title="Play pronunciation"
              on:click|stopPropagation={() => onPlayAudio(currentCard)}
            >
              {#if audioLoadingId === currentCard.id}
                <LoaderCircle class="animate-spin" size={20} />
              {:else}
                <Volume2 size={20} />
              {/if}
            </button>
          {/if}
        </div>
      </article>
    {:else}
      <div class="fc-empty">No study cards match these filters.</div>
    {/if}
  </div>

  <!-- Bottom controls -->
  <div class="fc-controls">
    <button class="fc-ctrl-btn" type="button" title="Shuffle cards" disabled={!deck.length} on:click={onShuffleDeck}>
      <Shuffle size={18} />
    </button>
    <button class="fc-ctrl-btn" type="button" title="Previous card" disabled={!deck.length} on:click={() => onMoveCard(-1)}>
      <ChevronLeft size={22} />
    </button>
    <button class="fc-ctrl-btn primary" type="button" title="Flip card" disabled={!deck.length} on:click={onFlipCard}>
      <RotateCcw size={20} />
    </button>
    <button class="fc-ctrl-btn" type="button" title="Next card" disabled={!deck.length} on:click={() => onMoveCard(1)}>
      <ChevronRight size={22} />
    </button>
  </div>
</div>

<style>
  .flashcards-page {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: #f7f8fb;
  }

  /* Toolbar */
  .fc-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 16px;
    border-bottom: 1px solid #e5e8ef;
    background: #fff;
    flex-shrink: 0;
  }
  .fc-toolbar-left, .fc-toolbar-right { display: flex; align-items: center; gap: 8px; }
  .fc-toolbar-center { display: flex; align-items: center; }

  .fc-counter { font-size: 13px; font-weight: 700; color: #667085; }
  .fc-counter-current { color: #17614f; font-size: 15px; }
  .fc-counter-sep { margin: 0 2px; }

  .fc-mode-switcher, .fc-img-switcher {
    display: flex;
    align-items: center;
    gap: 2px;
    background: #f0f2f7;
    border-radius: 8px;
    padding: 3px;
    border: 1px solid #e5e8ef;
  }
  .fc-img-label { font-size: 9px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #667085; padding: 0 6px; }
  .fc-mode-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 30px;
    padding: 0 14px;
    border-radius: 6px;
    border: none;
    background: transparent;
    font-size: 11px;
    font-weight: 700;
    color: #667085;
    cursor: pointer;
    transition: all 0.15s;
  }
  .fc-mode-btn.small { padding: 0 10px; height: 26px; font-size: 10px; }
  .fc-mode-btn:hover { color: #202124; background: #fff; }
  .fc-mode-btn.active { background: #17614f; color: #fff; box-shadow: 0 1px 4px rgba(23,97,79,0.25); }

  /* Progress */
  .fc-progress-track { height: 3px; background: #e5e8ef; flex-shrink: 0; }
  .fc-progress-fill { height: 100%; background: #17614f; border-radius: 0 2px 2px 0; transition: width 0.3s ease; }

  /* Card area */
  .fc-card-area {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    overflow: hidden;
  }

  .fc-card {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    max-width: 540px;
    min-height: 320px;
    padding: 32px 28px;
    border-radius: 16px;
    border: 2px solid #e5e8ef;
    background: #fff;
    cursor: pointer;
    touch-action: pan-y;
    user-select: none;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
    box-shadow: 0 2px 12px rgba(0,0,0,0.04), 0 0 0 0 transparent;
  }
  .fc-card:hover { border-color: #17614f; box-shadow: 0 4px 20px rgba(23,97,79,0.08); }
  .fc-card.flipped { border-color: #a77716; background: #fffbf2; box-shadow: 0 4px 20px rgba(167,119,22,0.08); }
  .fc-card.transitioning { transition: transform 0.15s ease-out; }

  .fc-edit-btn {
    position: absolute;
    top: 12px;
    right: 12px;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid #e5e8ef;
    background: #f7f8fb;
    color: #667085;
    cursor: pointer;
    opacity: 0;
    transition: all 0.15s;
  }
  .fc-card:hover .fc-edit-btn { opacity: 1; }
  .fc-edit-btn:hover { color: #202124; border-color: #202124; }

  .fc-card-inner {
    display: grid;
    gap: 16px;
    width: 100%;
    max-width: 420px;
    text-align: center;
    justify-items: center;
  }

  .fc-card-meta { font-size: 11px; font-weight: 700; color: #667085; }
  .fc-card-tag { padding: 4px 10px; border-radius: 6px; }
  .fc-card-tag.answer { background: rgba(167,119,22,0.12); color: #a77716; }

  .fc-card-figure { width: 100%; max-width: 320px; }
  .fc-img-loading {
    width: 100%;
    aspect-ratio: 16/10;
    border-radius: 10px;
    border: 1px solid #e5e8ef;
    display: grid;
    place-items: center;
    background: #f7f8fb;
    color: #aab2c0;
  }
  .fc-card-img {
    width: 100%;
    aspect-ratio: 16/10;
    border-radius: 10px;
    border: 1px solid #e5e8ef;
    object-fit: cover;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  }

  .fc-card-word {
    font-size: clamp(2rem, 6vw, 3.2rem);
    font-weight: 800;
    line-height: 1.15;
    color: #202124;
    word-break: break-word;
  }

  .fc-senses {
    margin: 0;
    padding-left: 24px;
    text-align: left;
    list-style: decimal;
    font-size: clamp(1.1rem, 3vw, 1.5rem);
    font-weight: 600;
    line-height: 1.5;
    color: #202124;
  }
  .fc-senses li + li { margin-top: 6px; }

  .fc-card-sub { font-size: 13px; font-weight: 600; color: #667085; }
  .fc-card-hint { font-size: 13px; font-weight: 600; color: #667085; }

  .fc-audio-btn {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 10px;
    border: 1px solid #e5e8ef;
    background: #fff;
    color: #17614f;
    cursor: pointer;
    transition: all 0.15s;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  }
  .fc-audio-btn:hover { border-color: #17614f; box-shadow: 0 2px 8px rgba(23,97,79,0.12); }

  .fc-empty { font-size: 14px; color: #667085; font-weight: 600; }

  /* Bottom controls */
  .fc-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 14px 16px;
    border-top: 1px solid #e5e8ef;
    background: #fff;
    flex-shrink: 0;
  }

  .fc-ctrl-btn {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    border: 1px solid #e5e8ef;
    background: #fff;
    color: #202124;
    cursor: pointer;
    transition: all 0.15s;
  }
  .fc-ctrl-btn:hover { border-color: #17614f; color: #17614f; box-shadow: 0 2px 8px rgba(23,97,79,0.1); }
  .fc-ctrl-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .fc-ctrl-btn.primary {
    width: 52px;
    height: 52px;
    background: #17614f;
    color: #fff;
    border-color: #17614f;
    border-radius: 50%;
    box-shadow: 0 2px 10px rgba(23,97,79,0.25);
  }
  .fc-ctrl-btn.primary:hover { background: #124a3c; }

  @media (min-width: 640px) {
    .fc-card { min-height: 380px; padding: 40px 36px; }
    .fc-card-area { padding: 32px 24px; }
  }
</style>
