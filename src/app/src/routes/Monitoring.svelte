<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import Card from '$lib/components/ui/card/card.svelte';
  import CardHeader from '$lib/components/ui/card/card-header.svelte';
  import CardTitle from '$lib/components/ui/card/card-title.svelte';
  import CardContent from '$lib/components/ui/card/card-content.svelte';
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';
  import Table from '$lib/components/ui/table/table.svelte';
  let metrics: any = null;
  let err: string | null = null;
  let loading = false;
  async function load() {
    loading = true;
    err = null;
    try {
      const r = await fetch('/metrics');
      metrics = await r.json();
    } catch (e) {
      err = (e as Error).message;
    } finally {
      loading = false;
    }
  }
  load();
</script>

<section class="compact-section">
  <div class="flex items-center justify-between mb-4">
    <h1 class="text-xl font-semibold text-emphasis">System Monitoring</h1>
    <Button on:click={load} disabled={loading} variant="outline" class="text-xs h-8 px-3">
      {loading ? 'Loading...' : 'Refresh'}
    </Button>
  </div>
  {#if err}
    <Card class="border-destructive">
      <CardContent class="compact-card">
        <div class="text-destructive text-xs" role="alert" aria-live="polite">{err}</div>
      </CardContent>
    </Card>
  {/if}
  {#if loading}
    <div class="grid md:grid-cols-2 gap-3">
      <Card>
        <CardHeader class="compact-card pb-2"><Skeleton class="h-4 w-24" /></CardHeader>
        <CardContent class="compact-card pt-0"><Skeleton class="h-32 w-full" /></CardContent>
      </Card>
      <Card>
        <CardHeader class="compact-card pb-2"><Skeleton class="h-4 w-24" /></CardHeader>
        <CardContent class="compact-card pt-0"><Skeleton class="h-32 w-full" /></CardContent>
      </Card>
    </div>
  {:else if metrics}
    <div class="grid md:grid-cols-2 gap-3">
      <Card>
        <CardHeader class="compact-card pb-2">
          <CardTitle class="text-sm">Connections</CardTitle>
        </CardHeader>
        <CardContent class="compact-card pt-0">
          <Table
            columns={[
              { key: 'key', header: 'Metric' },
              { key: 'value', header: 'Value' },
            ]}
            items={Object.entries(metrics?.connections || {}).map(([k, v]) => ({
              key: k,
              value: String(v),
            }))}
            class="text-xs"
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader class="compact-card pb-2">
          <CardTitle class="text-sm">Shards</CardTitle>
        </CardHeader>
        <CardContent class="compact-card pt-0">
          <Table
            columns={[
              { key: 'key', header: 'Metric' },
              { key: 'value', header: 'Value' },
            ]}
            items={Object.entries(metrics?.shards || {}).map(([k, v]) => ({
              key: k,
              value: String(v),
            }))}
            class="text-xs"
          />
        </CardContent>
      </Card>
    </div>
    <Card>
      <CardHeader class="compact-card pb-2">
        <CardTitle class="text-sm">Raw Metrics</CardTitle>
      </CardHeader>
      <CardContent class="compact-card pt-0">
        <pre
          class="text-xs overflow-auto max-h-[300px] bg-muted p-3 rounded-md"
          role="region"
          aria-label="Raw metrics data">{JSON.stringify(metrics, null, 2)}</pre>
      </CardContent>
    </Card>
  {/if}
</section>
