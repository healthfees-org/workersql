<script lang="ts">
  import { cn } from '$lib/utils';
  export let className: string = '';
  $: classes = cn('p-6 pt-0', className, ($$props['class'] as string));
</script>

<div {...$$restProps} class={classes}>
  <slot />
</div>
