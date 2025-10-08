<script lang="ts">
  import { cn } from '$lib/utils';
  export let className: string = '';
  $: classes = cn('flex flex-col space-y-1.5 p-6', className, ($$props['class'] as string));
</script>

<div {...$$restProps} class={classes}>
  <slot />
</div>
