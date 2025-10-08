<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import Table from '$lib/components/ui/table/table.svelte';
  import Card from '$lib/components/ui/card/card.svelte';
  import CardHeader from '$lib/components/ui/card/card-header.svelte';
  import CardTitle from '$lib/components/ui/card/card-title.svelte';
  import CardContent from '$lib/components/ui/card/card-content.svelte';
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';

  let plans: any = null;
  $: planItems = Array.isArray(plans?.data) ? (plans.data as any[]) : [];
  let error: string | null = null;
  let loading = false;

  async function loadPlans() {
    loading = true;
    try {
      const res = await fetch('/admin/shards/split');
      const data = await res.json();
      plans = data;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  // Default export for svelte-routing
  loadPlans();
</script>

<section class="compact-section">
  <div class="flex items-center justify-between mb-4">
    <h1 class="text-xl font-semibold text-emphasis">Migration Utilities</h1>
    <p class="text-xs text-muted-foreground">Shard management and schema updates</p>
  </div>
  <Card>
    <CardHeader class="compact-card pb-2">
      <div class="flex items-center justify-between">
        <CardTitle class="text-sm">Shard Split Plans</CardTitle>
        <Button on:click={loadPlans} disabled={loading} variant="outline" class="text-xs h-7 px-2">
          Refresh
        </Button>
      </div>
    </CardHeader>
    <CardContent class="compact-card pt-0">
      {#if error}
        <div class="text-destructive text-xs" role="alert" aria-live="polite">{error}</div>
      {:else if loading}
        <Skeleton class="h-24 w-full" />
      {:else if Array.isArray(plans?.data)}
        <div class="overflow-x-auto">
          <Table
            columns={[
              { key: 'id', header: 'ID' },
              { key: 'status', header: 'Status' },
              { key: 'sourceShard', header: 'Source' },
            ]}
            items={planItems}
            class="text-xs"
          />
        </div>
      {:else if plans}
        <pre
          class="text-xs overflow-auto max-h-[300px] bg-muted p-3 rounded-md"
          role="region"
          aria-label="Plan details">{JSON.stringify(plans, null, 2)}</pre>
      {/if}
    </CardContent>
  </Card>
</section>
