<script lang="ts">
  import { cn } from '$lib/utils';
  export let value = '';
  export let placeholder = '';
  export let type: string = 'text';
  export let className: string = '';
  export let id = '';
  export let ariaLabel = '';
</script>

<input
  {id}
  {value}
  {placeholder}
  {type}
  aria-label={ariaLabel}
  {...$$restProps}
  class={cn(
    'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
    className,
    // Merge any class passed directly on the component instance
    $$props['class'] || ''
  )}
  on:input
  on:change
  on:focus
  on:blur
/>
