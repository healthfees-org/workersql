<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/components/ui/card/card.svelte';
  import CardHeader from '$lib/components/ui/card/card-header.svelte';
  import CardTitle from '$lib/components/ui/card/card-title.svelte';
  import CardContent from '$lib/components/ui/card/card-content.svelte';
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';

  let info: unknown = null;
  let error: string | null = null;
  let loading = true;

  async function check() {
    try {
      const res = await fetch('/health');
      if (!res.ok) throw new Error('Failed to fetch health');
      info = await res.json();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void check();
  });
</script>

<section class="compact-section">
  <div class="flex items-center justify-between mb-4">
    <h1 class="text-xl font-semibold text-emphasis">Security</h1>
    <p class="text-xs text-muted-foreground">Health and access control</p>
  </div>
  <Card>
    <CardHeader class="compact-card pb-2">
      <CardTitle class="text-sm">System Health</CardTitle>
    </CardHeader>
    <CardContent class="compact-card pt-0">
      <p class="text-xs text-muted-foreground mb-3">
        Cloudflare Access/Zero Trust enforced at the gateway level.
      </p>
      {#if error}
        <div class="text-destructive text-xs" role="alert" aria-live="polite">{error}</div>
      {:else if loading}
        <Skeleton class="h-20 w-full" />
      {:else if info}
        <pre
          class="text-xs overflow-auto max-h-[200px] bg-muted p-3 rounded-md"
          role="region"
          aria-label="Health status">{JSON.stringify(info, null, 2)}</pre>
      {/if}
    </CardContent>
  </Card>
</section>
