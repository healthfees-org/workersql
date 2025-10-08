<script lang="ts">
  import { cn } from '$lib/utils';
  export let variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' = 'default';
  export let size: 'sm' | 'md' | 'lg' = 'md';
  // 'class' is a reserved word in TS in this context; accept className and merge with incoming $$props.class
  export let className: string = '';
  export let type: 'button' | 'submit' | 'reset' = 'button';
  export let disabled = false;
  const base =
    'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';
  const variants: Record<string, string> = {
    default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
    secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
    destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
    outline:
      'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
  };
  const sizes: Record<string, string> = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-9 px-4 py-2',
    lg: 'h-10 px-8',
  };
  $: classes = cn(base, variants[variant], sizes[size], className, $$props['class'] as string);
</script>

<button {...$$restProps} {type} {disabled} class={classes} on:click>
  <slot />
</button>
