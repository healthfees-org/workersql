<script lang="ts">
  import { cn } from '$lib/utils';
  // Use className to avoid reserved identifier issues and merge with incoming class
  export let className: string = '';
  export let rows: number | undefined = undefined;
  export let value: string | undefined = undefined;
  export let ariaLabel: string = '';
</script>

<textarea
  {rows}
  bind:value
  aria-label={ariaLabel}
  {...$$restProps}
  class={cn(
    'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
    className,
    // Merge any class passed directly on the component instance
    $$props['class'] || ''
  )}
></textarea>
