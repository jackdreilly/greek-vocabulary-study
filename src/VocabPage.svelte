<script>
  import {
    Edit2,
    LoaderCircle,
    Volume2,
    Search,
  } from "lucide-svelte";

  export let entries = [];
  export let showGroupFilter = false;
  export let imageMode = "back";
  export let audioLoadingId = null;
  export let onPlayAudio = () => {};
  export let onOpenEdit = () => {};

  let search = "";
  let expandedImageId = null;
  let loadMoreCount = 0;

  const RENDER_LIMIT = 420;

  const typeLabels = {
    "Ουσιαστικά": "Nouns",
    "Επίθετα": "Adjectives",
    "Ρήματα": "Verbs",
    "Εκφράσεις": "Phrases",
    "Top 5000": "Top 5000",
  };

  const groupLabels = {
    art: "Articles", part: "Particles", v: "Verbs", n: "Nouns",
    adj: "Adjectives", adv: "Adverbs", prep: "Prepositions",
    pron: "Pronouns", conj: "Conjunctions", interj: "Interjections",
    inter: "Interjections", int: "Interjections", det: "Determiners",
    num: "Numbers", coll: "Collective",
  };

  const displayType = (value) => typeLabels[value] ?? value;
  const displayGroup = (key) => groupLabels[key] ?? key;

  const normalise = (value) =>
    String(value ?? "")
      .toLocaleLowerCase("el")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");

  function getSenses(entry) {
    if (Array.isArray(entry.english_senses) && entry.english_senses.length) {
      return entry.english_senses;
    }
    return entry.english ? entry.english.split(/\s*;\s*/).filter(Boolean) : [];
  }

  function imageSrc(image) {
    return image?.url || image?.thumbnail || "";
  }

  function matchesSearch(entry) {
    if (!search) return true;
    const haystack = normalise(
      [entry.term, entry.lemma, entry.article, entry.english,
       getSenses(entry).join(" "), entry.dictionary_headword,
       entry.top5000_definition, entry.theme, entry.category, entry.subsection,
      ].join(" "),
    );
    return haystack.includes(normalise(search));
  }

  $: filtered = entries.filter(matchesSearch);
  $: visible = filtered.slice(0, RENDER_LIMIT + (loadMoreCount * RENDER_LIMIT));
  $: { search; loadMoreCount = 0; }
</script>

<div class="vocab-page">
  <div class="vocab-toolbar">
    <div class="vocab-count">{filtered.length.toLocaleString()} words</div>
    <label class="vocab-search-wrap">
      <Search class="vocab-search-icon" size={16} />
      <input
        class="vocab-search"
        type="search"
        bind:value={search}
        placeholder="Search vocabulary..."
      />
    </label>
  </div>

  <div class="vocab-grid-scroll">
    <div class="vocab-grid">
      {#each visible as entry}
        <article class="vocab-card group">
          <button
            class="vocab-edit-btn"
            title="Edit word"
            on:click={() => onOpenEdit(entry)}
          >
            <Edit2 size={13} />
          </button>

          {#if entry.image && imageMode !== "none"}
            <button
              type="button"
              class="vocab-img-wrap"
              on:click={() => expandedImageId = expandedImageId === entry.id ? null : entry.id}
            >
              <img
                class="vocab-img {expandedImageId === entry.id ? 'expanded' : ''}"
                style={`object-position: ${entry.image.position || 'center'};`}
                src={imageSrc(entry.image)}
                alt=""
                loading="lazy"
                decoding="async"
              />
            </button>
          {/if}

          <div class="vocab-card-head">
            <div class="vocab-lemma">{entry.lemma}</div>
            {#if entry.audio_path}
              <button
                class="icon-button h-8 w-8"
                type="button"
                title="Play pronunciation"
                aria-label="Play pronunciation"
                on:click={() => onPlayAudio(entry)}
              >
                {#if audioLoadingId === entry.id}
                  <LoaderCircle class="animate-spin" size={15} />
                {:else}
                  <Volume2 size={15} />
                {/if}
              </button>
            {/if}
          </div>

          {#if getSenses(entry).length}
            <ol class="vocab-senses">
              {#each getSenses(entry).slice(0, 4) as sense}
                <li>{sense}</li>
              {/each}
            </ol>
          {:else}
            <p class="vocab-no-meaning">Meaning not available yet</p>
          {/if}

          <div class="vocab-tags">
            {#if entry.article}
              <span class="chip">{entry.article}</span>
            {/if}
            <span class="chip">{displayType(entry.category)}</span>
            {#if showGroupFilter}
              {#each entry.groupKeys as group}
                <span class="chip">{displayGroup(group)}</span>
              {/each}
            {/if}
          </div>
        </article>
      {/each}
    </div>

    {#if filtered.length > visible.length}
      <div class="vocab-load-more">
        <p>Showing {visible.length.toLocaleString()} of {filtered.length.toLocaleString()} words.</p>
        <button class="vocab-load-btn" on:click={() => loadMoreCount++}>
          Load more words
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .vocab-page {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .vocab-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid #e5e8ef;
    background: #fff;
    flex-shrink: 0;
  }
  .vocab-count { font-size: 13px; font-weight: 700; color: #667085; white-space: nowrap; }

  .vocab-search-wrap {
    position: relative;
    display: block;
    width: 100%;
    max-width: 320px;
  }
  :global(.vocab-search-icon) {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: #667085;
    pointer-events: none;
  }
  .vocab-search {
    width: 100%;
    height: 36px;
    padding: 0 12px 0 34px;
    border: 1px solid #e5e8ef;
    border-radius: 8px;
    background: #f7f8fb;
    font-size: 13px;
    color: #202124;
    outline: none;
    transition: border-color 0.15s;
  }
  .vocab-search:focus { border-color: #087985; }

  .vocab-grid-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .vocab-grid {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }

  .vocab-card {
    position: relative;
    min-height: 120px;
    padding: 14px;
    border-radius: 10px;
    border: 1px solid #e5e8ef;
    background: #fff;
    transition: border-color 0.15s;
  }
  .vocab-card:hover { border-color: #17614f; }

  .vocab-edit-btn {
    position: absolute;
    right: 8px;
    top: 8px;
    z-index: 2;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid #e5e8ef;
    background: #f7f8fb;
    color: #667085;
    cursor: pointer;
    opacity: 0;
    transition: all 0.15s;
  }
  .vocab-card:hover .vocab-edit-btn { opacity: 1; }
  .vocab-edit-btn:hover { color: #202124; border-color: #202124; }

  .vocab-img-wrap {
    display: block;
    width: 100%;
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    outline: none;
    text-align: left;
  }
  .vocab-img {
    width: 100%;
    aspect-ratio: 16/9;
    border-radius: 8px;
    border: 1px solid #e5e8ef;
    object-fit: cover;
    margin-bottom: 10px;
    transition: all 0.3s;
  }
  .vocab-img.expanded { aspect-ratio: 1; max-height: 256px; }

  .vocab-card-head { display: flex; align-items: start; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .vocab-lemma { font-size: 17px; font-weight: 700; line-height: 1.3; color: #202124; word-break: break-word; }

  .vocab-senses {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
    line-height: 1.45;
    color: #667085;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .vocab-no-meaning { margin: 0; font-size: 13px; font-style: italic; color: #a24f3f; }

  .vocab-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }

  .vocab-load-more {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 24px;
    margin-top: 16px;
    border-radius: 10px;
    border: 1px dashed #e5e8ef;
    background: rgba(255,255,255,0.7);
    font-size: 13px;
    font-weight: 600;
    color: #667085;
  }
  .vocab-load-btn {
    padding: 8px 20px;
    border-radius: 8px;
    border: none;
    background: rgba(23,97,79,0.1);
    color: #17614f;
    font-weight: 700;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .vocab-load-btn:hover { background: rgba(23,97,79,0.2); }
</style>
