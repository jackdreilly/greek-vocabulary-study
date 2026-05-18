<script lang="ts">
  import { linkClick } from "../lib/router.svelte";
  import { History, Sliders } from "lucide-svelte";

  const cards = [
    { href: "/admin/ai", title: "AI Configuration", desc: "Model choices, decoding overrides, feature flags.", Icon: Sliders },
    { href: "/admin/generations", title: "Generations", desc: "Lineage log + bulk revert.", Icon: History },
  ];
</script>

<div class="max-w-3xl mx-auto pt-12 pb-24 px-6">
  <header class="mb-10">
    <p class="text-xs tracking-widest uppercase text-(--color-muted) mb-2 font-semibold">Admin</p>
    <h1 class="text-3xl font-semibold tracking-tight">Internal tools</h1>
  </header>
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
    {#each cards as card}
      {@const Icon = card.Icon}
      <a
        href={card.href}
        onclick={linkClick(card.href)}
        class="block rounded-lg border border-(--color-border) bg-(--color-surface) p-5 hover:border-(--color-border-strong)"
      >
        <h2 class="inline-flex items-center gap-2 text-base font-semibold tracking-tight">
          <Icon size={16} aria-hidden="true" class="text-(--color-muted)" />
          {card.title}
        </h2>
        <p class="mt-1 text-sm text-(--color-muted)">{card.desc}</p>
      </a>
    {/each}
  </div>
</div>
