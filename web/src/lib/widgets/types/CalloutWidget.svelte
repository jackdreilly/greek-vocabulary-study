<script lang="ts">
  import MarkdownBody from "../../ui/MarkdownBody.svelte";

  type Kind = "pattern" | "history" | "etymology" | "tip" | "cultural" | "mnemonic";
  let {
    calloutKind,
    title,
    markdown,
    body,
  }: { calloutKind: Kind; title?: string; markdown?: string; body?: string } = $props();

  const styles: Record<Kind, { label: string; classes: string }> = {
    pattern: { label: "Pattern", classes: "bg-[#eff6ff] border-[#bfdbfe] text-[#1e40af]" },
    history: { label: "History", classes: "bg-[#fef3c7] border-[#fde68a] text-[#92400e]" },
    etymology: { label: "Etymology", classes: "bg-[#f3e8ff] border-[#d8b4fe] text-[#6b21a8]" },
    tip: { label: "Tip", classes: "bg-[#f0fdf4] border-[#bbf7d0] text-[#15803d]" },
    cultural: { label: "Cultural", classes: "bg-[#fff7ed] border-[#fdba74] text-[#9a3412]" },
    mnemonic: { label: "Mnemonic", classes: "bg-[#fdf4ff] border-[#f0abfc] text-[#86198f]" },
  };

  const style = $derived(styles[calloutKind] ?? styles.tip);
  const content = $derived(markdown ?? body ?? "");
</script>

<aside class="my-5 rounded-md border px-4 py-3 {style.classes}">
  <div class="text-[11px] font-semibold tracking-widest uppercase mb-1.5 opacity-80">
    {style.label}{title ? ` · ${title}` : ""}
  </div>
  <MarkdownBody markdown={content} />
</aside>
