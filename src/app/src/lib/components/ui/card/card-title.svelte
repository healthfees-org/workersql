<script lang="ts">
  import { cn } from '$lib/utils';
  export let className: string = '';
  $: classes = cn('font-semibold leading-none tracking-tight', className, ($$props['class'] as string));
</script>

<h3 {...$$restProps} class={classes}>
  <slot />
</h3>
