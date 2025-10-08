<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Card from '$lib/components/ui/card/card.svelte';
  import CardHeader from '$lib/components/ui/card/card-header.svelte';
  import CardTitle from '$lib/components/ui/card/card-title.svelte';
  import CardContent from '$lib/components/ui/card/card-content.svelte';
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';
  import Table from '$lib/components/ui/table/table.svelte';
  let logs: any = null;
  let q = `query CFLogs($accountTag: String!, $since: Time!, $until: Time!) { viewer { accounts(filter: { accountTag: $accountTag }) { httpRequests1mGroups(limit: 50, filter: { datetime_geq: $since, datetime_leq: $until }) { sum { requests } dimensions { datetime } } } } }`;
  let since = new Date(Date.now() - 3600_000).toISOString();
  let until = new Date().toISOString();
  let loading = false;
  $: tableRows = Array.isArray(logs?.data?.viewer?.accounts?.[0]?.httpRequests1mGroups)
    ? (logs.data.viewer.accounts[0].httpRequests1mGroups as any[]).map((g) => ({
        datetime: g?.dimensions?.datetime,
        requests: g?.sum?.requests,
      }))
    : [];
  let error: string | null = null;
  async function fetchLogs() {
    error = null;
    loading = true;
    try {
      const res = await fetch('/admin/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, variables: { since, until } }),
      });
      const data = await res.json();
      logs = data;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  // Removed stray default export
</script>

<section class="compact-section">
  <div class="flex items-center justify-between mb-4">
    <h1 class="text-xl font-semibold text-emphasis">Audit Logs</h1>
    <p class="text-xs text-muted-foreground">Query execution history</p>
  </div>
  <Card>
    <CardHeader class="compact-card pb-2">
      <CardTitle class="text-sm">Time Range</CardTitle>
    </CardHeader>
    <CardContent class="compact-card pt-0">
      <div class="grid sm:grid-cols-3 gap-2">
        <div>
          <label for="since" class="text-xs text-muted-foreground block mb-1">From</label>
          <Input
            id="since"
            bind:value={since}
            type="datetime-local"
            className="text-xs h-8"
            ariaLabel="Start date and time"
          />
        </div>
        <div>
          <label for="until" class="text-xs text-muted-foreground block mb-1">To</label>
          <Input
            id="until"
            bind:value={until}
            type="datetime-local"
            className="text-xs h-8"
            ariaLabel="End date and time"
          />
        </div>
        <div class="flex items-end">
          <Button on:click={fetchLogs} disabled={loading} className="w-full text-xs h-8">
            {loading ? 'Loading...' : 'Query Logs'}
          </Button>
        </div>
      </div>
    </CardContent>
  </Card>
  {#if error}
    <Card className="border-destructive">
      <CardContent className="compact-card">
        <div class="text-destructive text-xs" role="alert" aria-live="polite">{error}</div>
      </CardContent>
    </Card>
  {/if}
  {#if loading}
    <Card>
      <CardContent className="compact-card">
        <Skeleton className="h-48 w-full" />
      </CardContent>
    </Card>
  {:else if logs?.data?.viewer?.accounts?.[0]?.httpRequests1mGroups}
    <Card>
      <CardHeader className="compact-card pb-2">
        <CardTitle className="text-sm">HTTP Requests</CardTitle>
      </CardHeader>
      <CardContent className="compact-card pt-0">
        <div class="overflow-x-auto">
          <Table
            columns={[
              { key: 'datetime', header: 'Time' },
              { key: 'requests', header: 'Requests' },
            ]}
            items={tableRows}
            className="text-xs"
          />
        </div>
      </CardContent>
    </Card>
  {:else if logs}
    <Card>
      <CardHeader className="compact-card pb-2">
        <CardTitle className="text-sm">Raw Response</CardTitle>
      </CardHeader>
      <CardContent className="compact-card pt-0">
        <pre
          class="text-xs overflow-auto max-h-[300px] bg-muted p-3 rounded-md"
          role="region"
          aria-label="Raw log data">{JSON.stringify(logs, null, 2)}</pre>
      </CardContent>
    </Card>
  {/if}
</section>
