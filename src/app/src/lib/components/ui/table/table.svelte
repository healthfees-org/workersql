<script lang="ts">
  import { cn } from '$lib/utils';
  export let columns: Array<{ key: string; header: string }>;
  export let items: Array<Record<string, any>> = [];
  export let className: string = '';
  $: classes = cn('w-full overflow-auto', className, $$props['class'] as string);
</script>

<div {...$$restProps} class={classes}>
  <table class="w-full caption-bottom text-sm">
    <thead class="[&_tr]:border-b">
      <tr class="border-b transition-colors hover:bg-muted/50">
        {#each columns as c}
          <th
            class="h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]"
            >{c.header}</th
          >
        {/each}
      </tr>
    </thead>
    <tbody class="[&_tr:last-child]:border-0">
      {#each items as item}
        <tr class="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
          {#each columns as c}
            <td
              class="p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]"
              >{String(item?.[c.key] ?? '')}</td
            >
          {/each}
        </tr>
      {/each}
      {#if items.length === 0}
        <tr
          ><td class="p-2 text-center text-sm text-muted-foreground" colspan={columns.length}
            >No data</td
          ></tr
        >
      {/if}
    </tbody>
  </table>
</div>
