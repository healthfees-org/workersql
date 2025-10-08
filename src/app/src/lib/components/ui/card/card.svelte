<script lang="ts">
  import { cn } from '$lib/utils';
  export let className: string = '';
  $: classes = cn('rounded-xl border bg-card text-card-foreground shadow', className, ($$props['class'] as string));
</script>

<div {...$$restProps} class={classes}>
  <slot />
</div>
