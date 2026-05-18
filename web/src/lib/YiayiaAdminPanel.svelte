<script lang="ts">
  import { tick } from "svelte";
  import { renderMarkdown } from "./markdown";
  import {
    streamAdminChat,
    type AdminChatContext,
    type AdminChatMessage,
    type AdminToolCall,
  } from "./data/yiayiaAdmin";
  import { navigate } from "./router.svelte";
  import {
    ChevronDown,
    ChevronRight,
    Loader2,
    Send,
    ShieldCheck,
    Trash2,
    Wrench,
    X,
    AlertTriangle,
    CheckCircle2,
  } from "lucide-svelte";

  let {
    open,
    context,
    onClose,
  }: {
    open: boolean;
    context: AdminChatContext;
    onClose: () => void;
  } = $props();

  let messages = $state<AdminChatMessage[]>([]);
  let draft = $state("");
  let sending = $state(false);
  let error = $state("");
  let streamingText = $state("");
  let streamingToolCalls = $state<AdminToolCall[]>([]);
  let statusLine = $state("");
  let messagesEl = $state<HTMLElement | null>(null);
  let expanded = $state<Record<string, boolean>>({});

  function scrollToBottom() {
    if (!messagesEl) return;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function toggleExpanded(callId: string) {
    expanded = { ...expanded, [callId]: !expanded[callId] };
  }

  function previewInput(input: unknown): string {
    if (input == null) return "";
    if (typeof input === "string") return input.slice(0, 80);
    try {
      const json = JSON.stringify(input);
      return json.length > 80 ? `${json.slice(0, 80)}…` : json;
    } catch {
      return "";
    }
  }

  async function send() {
    const content = draft.trim();
    if (!content || sending) return;
    const nextMessages: AdminChatMessage[] = [...messages, { role: "user", content }];
    messages = nextMessages;
    draft = "";
    sending = true;
    error = "";
    streamingText = "";
    streamingToolCalls = [];
    statusLine = "Thinking…";
    await tick();
    scrollToBottom();

    try {
      const result = await streamAdminChat(
        {
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          context,
        },
        async (event) => {
          if (event.type === "text") {
            streamingText += event.delta;
          } else if (event.type === "tool_call") {
            streamingToolCalls = [
              ...streamingToolCalls,
              {
                id: event.id,
                name: event.name,
                input: event.input,
                status: "running",
              },
            ];
            statusLine = `Calling ${event.name}…`;
          } else if (event.type === "tool_result") {
            streamingToolCalls = streamingToolCalls.map((call) =>
              call.id === event.id
                ? {
                    ...call,
                    output: event.output,
                    error: event.error,
                    status: event.error ? "error" : "complete",
                  }
                : call,
            );
            statusLine = "";
          } else if (event.type === "status") {
            statusLine = event.message;
          } else if (event.type === "error") {
            error = event.message;
          }
          await tick();
          scrollToBottom();
        },
      );
      messages = [
        ...nextMessages,
        {
          role: "assistant",
          content: result.message,
          toolCalls: result.toolCalls,
          generationId: result.generationId,
        },
      ];
      streamingText = "";
      streamingToolCalls = [];
      statusLine = "";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      messages = [
        ...nextMessages,
        {
          role: "assistant",
          content: "",
          toolCalls: streamingToolCalls,
          error: err instanceof Error ? err.message : String(err),
        },
      ];
      streamingText = "";
      streamingToolCalls = [];
      statusLine = "";
    } finally {
      sending = false;
      await tick();
      scrollToBottom();
    }
  }

  function clearChat() {
    messages = [];
    streamingText = "";
    streamingToolCalls = [];
    statusLine = "";
    error = "";
  }

  function navTo(path: string) {
    navigate(path);
    onClose();
  }

  function shortcutsFor(call: AdminToolCall): { label: string; path: string }[] {
    const out = (call.output as Record<string, unknown> | undefined) ?? {};
    const links: { label: string; path: string }[] = [];
    if (typeof out.url === "string" && out.url.startsWith("/")) {
      const planId = typeof out.planId === "string" ? out.planId : "";
      const lessonId = typeof out.lessonId === "string" ? out.lessonId : "";
      const label = planId ? "Open plan" : lessonId ? "Open lesson" : "Open course";
      links.push({ label, path: out.url });
    } else if (typeof out.courseId === "string" && out.courseId) {
      const lessonId = typeof out.lessonId === "string" ? out.lessonId : "";
      const planId = typeof out.planId === "string" ? out.planId : "";
      if (planId && lessonId) {
        links.push({
          label: "Open plan",
          path: `/c/${out.courseId}/l/${lessonId}/plans/${planId}`,
        });
      } else if (lessonId) {
        links.push({
          label: "Open lesson",
          path: `/c/${out.courseId}/l/${lessonId}/vocab`,
        });
      } else {
        links.push({ label: "Open course", path: `/c/${out.courseId}` });
      }
    }
    return links;
  }

  const writeToolNames = new Set([
    "createCourse",
    "createLesson",
    "createPlan",
    "updateCourse",
    "updateLesson",
    "updateEntry",
    "updatePlan",
    "updateGame",
    "addLessonOverviewWidget",
    "addPlanWidget",
    "deleteEntry",
    "deleteGame",
    "deletePlan",
    "deleteLesson",
    "deleteCourse",
    "revertGeneration",
  ]);
</script>

{#if open}
  <div
    class="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-(--color-border) bg-(--color-bg) shadow-2xl sm:max-w-lg"
  >
    <!-- Header -->
    <header class="flex flex-shrink-0 items-center justify-between gap-3 border-b border-(--color-border) px-4 py-3">
      <div class="flex min-w-0 items-center gap-2">
        <ShieldCheck size={18} aria-hidden="true" class="flex-shrink-0 text-(--color-accent)" />
        <h2 class="text-sm font-bold tracking-tight">Yiayia · Admin</h2>
        {#if context.courseId}
          <span class="truncate rounded bg-(--color-surface-muted) px-2 py-0.5 text-[10px] font-bold text-(--color-muted)">
            {#if context.planId}
              plan {context.planId}
            {:else if context.lessonId}
              lesson {context.lessonId}
            {:else}
              course {context.courseId}
            {/if}
          </span>
        {/if}
      </div>
      <div class="flex items-center gap-1">
        {#if messages.length > 0}
          <button
            type="button"
            onclick={clearChat}
            class="grid h-7 w-7 place-items-center rounded text-(--color-muted) hover:bg-(--color-surface-muted) hover:text-(--color-text)"
            title="Clear chat"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        {/if}
        <button
          type="button"
          onclick={onClose}
          class="grid h-7 w-7 place-items-center rounded text-(--color-muted) hover:bg-(--color-surface-muted) hover:text-(--color-text)"
          title="Close"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </header>

    <!-- Messages -->
    <div bind:this={messagesEl} class="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
      {#if messages.length === 0 && !sending}
        <div class="rounded-lg border border-(--color-border) bg-(--color-surface-muted) p-4 text-sm text-(--color-muted)">
          <p class="font-semibold text-(--color-text)">Admin chat</p>
          <p class="mt-1.5">
            Ask Yiayia to create, edit, delete, or revert anything in the content tree.
            Examples:
          </p>
          <ul class="mt-2 ml-4 list-disc space-y-0.5 text-xs">
            <li>"Add a lesson about Greek breakfast vocabulary."</li>
            <li>"Delete this course." (with cascade)</li>
            <li>"Create a new plan focused on noun gender."</li>
            <li>"Show recent generations and revert the last one."</li>
            <li>"Rewrite the description of this lesson to be friendlier."</li>
          </ul>
        </div>
      {/if}

      {#each messages as message, idx (idx)}
        {#if message.role === "user"}
          <div class="ml-12 self-end rounded-xl rounded-br-sm bg-(--color-accent) px-3 py-2 text-sm text-white">
            <p class="whitespace-pre-wrap">{message.content}</p>
          </div>
        {:else}
          <div class="flex flex-col gap-1.5">
            {#if message.toolCalls && message.toolCalls.length > 0}
              <div class="flex flex-col gap-1.5">
                {#each message.toolCalls as call (call.id)}
                  {@const isWrite = writeToolNames.has(call.name)}
                  {@const isOpen = expanded[call.id]}
                  <div
                    class="rounded-lg border bg-(--color-surface-muted) text-xs"
                    class:border-(--color-border)={!isWrite}
                    class:border-amber-300={isWrite && call.status === "complete"}
                    class:border-red-300={call.status === "error"}
                  >
                    <button
                      type="button"
                      onclick={() => toggleExpanded(call.id)}
                      class="flex w-full items-start gap-2 px-2.5 py-1.5 text-left"
                    >
                      <span class="mt-0.5 flex-shrink-0">
                        {#if call.status === "running"}
                          <Loader2 size={12} aria-hidden="true" class="animate-spin text-(--color-muted)" />
                        {:else if call.status === "error"}
                          <AlertTriangle size={12} aria-hidden="true" class="text-(--color-danger)" />
                        {:else if isWrite}
                          <Wrench size={12} aria-hidden="true" class="text-amber-600" />
                        {:else}
                          <CheckCircle2 size={12} aria-hidden="true" class="text-(--color-muted)" />
                        {/if}
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="font-mono font-semibold text-(--color-text)">{call.name}</span>
                        <span class="ml-2 text-(--color-muted)">{previewInput(call.input)}</span>
                      </span>
                      {#if isOpen}
                        <ChevronDown size={12} aria-hidden="true" class="mt-0.5 flex-shrink-0 text-(--color-muted)" />
                      {:else}
                        <ChevronRight size={12} aria-hidden="true" class="mt-0.5 flex-shrink-0 text-(--color-muted)" />
                      {/if}
                    </button>
                    {#if isOpen}
                      <div class="border-t border-(--color-border) px-2.5 py-2 font-mono text-[11px] leading-relaxed">
                        <p class="text-(--color-muted)">input</p>
                        <pre class="mt-0.5 overflow-x-auto whitespace-pre-wrap break-words text-(--color-text)">{JSON.stringify(call.input, null, 2)}</pre>
                        {#if call.error}
                          <p class="mt-2 text-(--color-danger)">error</p>
                          <pre class="mt-0.5 whitespace-pre-wrap break-words text-(--color-danger)">{call.error}</pre>
                        {:else if call.output != null}
                          <p class="mt-2 text-(--color-muted)">output</p>
                          <pre class="mt-0.5 overflow-x-auto whitespace-pre-wrap break-words text-(--color-text)">{JSON.stringify(call.output, null, 2)}</pre>
                        {/if}
                      </div>
                    {/if}
                    {#if !isOpen && call.status === "complete"}
                      {@const shortcuts = shortcutsFor(call)}
                      {#if shortcuts.length > 0}
                        <div class="border-t border-(--color-border) px-2.5 py-1 text-[11px]">
                          {#each shortcuts as shortcut}
                            <button
                              type="button"
                              onclick={() => navTo(shortcut.path)}
                              class="text-(--color-accent) hover:underline"
                            >
                              {shortcut.label} →
                            </button>
                          {/each}
                        </div>
                      {/if}
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}

            {#if message.content}
              <div class="yiayia-admin-assistant mr-12 self-start rounded-xl rounded-bl-sm border border-(--color-border) bg-(--color-surface-muted) px-3 py-2 text-sm text-(--color-text)">
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                {@html renderMarkdown(message.content)}
              </div>
            {/if}

            {#if message.generationId}
              <div class="mr-12 self-start text-[11px] text-(--color-muted)">
                Lineage:
                <button
                  type="button"
                  onclick={() => navTo(`/admin/generations/${message.generationId}`)}
                  class="font-mono text-(--color-accent) hover:underline"
                >
                  {message.generationId.slice(0, 24)}…
                </button>
              </div>
            {/if}

            {#if message.error}
              <p class="mr-12 self-start rounded-md bg-[#fef2f2] px-3 py-2 text-sm text-(--color-danger)">
                {message.error}
              </p>
            {/if}
          </div>
        {/if}
      {/each}

      <!-- Streaming preview -->
      {#if sending}
        <div class="flex flex-col gap-1.5">
          {#if streamingToolCalls.length > 0}
            <div class="flex flex-col gap-1.5">
              {#each streamingToolCalls as call (call.id)}
                {@const isWrite = writeToolNames.has(call.name)}
                <div
                  class="rounded-lg border bg-(--color-surface-muted) text-xs"
                  class:border-(--color-border)={!isWrite}
                  class:border-amber-300={isWrite}
                  class:border-red-300={call.status === "error"}
                >
                  <div class="flex w-full items-start gap-2 px-2.5 py-1.5">
                    <span class="mt-0.5 flex-shrink-0">
                      {#if call.status === "running"}
                        <Loader2 size={12} aria-hidden="true" class="animate-spin text-(--color-muted)" />
                      {:else if call.status === "error"}
                        <AlertTriangle size={12} aria-hidden="true" class="text-(--color-danger)" />
                      {:else if isWrite}
                        <Wrench size={12} aria-hidden="true" class="text-amber-600" />
                      {:else}
                        <CheckCircle2 size={12} aria-hidden="true" class="text-(--color-muted)" />
                      {/if}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="font-mono font-semibold text-(--color-text)">{call.name}</span>
                      <span class="ml-2 text-(--color-muted)">{previewInput(call.input)}</span>
                    </span>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
          {#if streamingText}
            <div class="yiayia-admin-assistant mr-12 self-start rounded-xl rounded-bl-sm border border-(--color-border) bg-(--color-surface-muted) px-3 py-2 text-sm text-(--color-text)">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html renderMarkdown(streamingText)}<span class="animate-pulse">▍</span>
            </div>
          {:else if statusLine}
            <div class="mr-12 self-start rounded-xl rounded-bl-sm border border-(--color-border) bg-(--color-surface-muted) px-3 py-2 text-sm text-(--color-muted)">
              {statusLine}<span class="animate-pulse">…</span>
            </div>
          {/if}
        </div>
      {/if}

      {#if error}
        <p class="rounded-md bg-[#fef2f2] px-3 py-2 text-sm text-(--color-danger)">{error}</p>
      {/if}
    </div>

    <!-- Compose -->
    <div class="flex-shrink-0 border-t border-(--color-border) px-3 py-3">
      <div class="flex gap-2">
        <textarea
          bind:value={draft}
          placeholder="Ask Yiayia to create, edit, delete, or revert anything…"
          rows="2"
          class="min-w-0 flex-1 resize-none rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm focus:border-(--color-accent) focus:outline-none focus:ring-1 focus:ring-(--color-accent)"
          onkeydown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        ></textarea>
        <button
          type="button"
          onclick={() => void send()}
          disabled={sending || draft.trim().length === 0}
          class="grid h-9 w-9 flex-shrink-0 place-items-center self-end rounded-md bg-(--color-accent) text-white hover:bg-(--color-accent-hover) disabled:opacity-40"
          title="Send"
        >
          {#if sending}
            <Loader2 size={14} aria-hidden="true" class="animate-spin" />
          {:else}
            <Send size={14} aria-hidden="true" />
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .yiayia-admin-assistant :global(p) { margin: 0; }
  .yiayia-admin-assistant :global(p + p) { margin-top: 0.4rem; }
  .yiayia-admin-assistant :global(ul),
  .yiayia-admin-assistant :global(ol) { margin: 0.25rem 0; padding-left: 1.2rem; }
  .yiayia-admin-assistant :global(li + li) { margin-top: 0.15rem; }
  .yiayia-admin-assistant :global(h1),
  .yiayia-admin-assistant :global(h2),
  .yiayia-admin-assistant :global(h3) { margin: 0.3rem 0 0.1rem; font-size: 0.85rem; font-weight: 700; }
  .yiayia-admin-assistant :global(code) { border-radius: 0.2rem; background: var(--color-surface-muted); padding: 0.05rem 0.2rem; font-size: 0.85em; }
  .yiayia-admin-assistant :global(strong) { font-weight: 700; }
</style>
