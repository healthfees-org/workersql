<script lang="ts">
  import { cn } from '$lib/utils';
  export let className: string = '';
  $: classes = cn('flex h-10 w-full animate-pulse rounded-md bg-muted', className, ($$props['class'] as string));
</script>

<div {...$$restProps} class={classes} />
