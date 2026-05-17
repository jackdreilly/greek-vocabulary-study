<script lang="ts">
  let { headers = [], rows = [] }: { headers?: string[]; rows?: string[][] } = $props();
</script>

<table class="w-full border-collapse text-sm my-6">
  <thead>
    <tr>
      {#each headers as h}
        <th
          class="border border-(--color-border) bg-(--color-surface-muted) px-3 py-1.5 text-left font-semibold"
        >
          {h}
        </th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each rows as row}
      <tr>
        {#each row as cell}
          <td class="border border-(--color-border) px-3 py-1.5">{cell}</td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>
