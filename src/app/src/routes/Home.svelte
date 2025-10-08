<script lang="ts">
  import { navigate } from 'svelte-routing';
  import Button from '$lib/components/ui/button/button.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import Card from '$lib/components/ui/card/card.svelte';
  import CardHeader from '$lib/components/ui/card/card-header.svelte';
  import CardTitle from '$lib/components/ui/card/card-title.svelte';
  import CardContent from '$lib/components/ui/card/card-content.svelte';
  let sql =
    '-- WorkerSQL Demo Query\nSELECT * FROM information_schema.tables\nWHERE table_schema = DATABASE()\nLIMIT 10;';
  let result: unknown = null;
  let error: string | null = null;
  let loading = false;

  async function runQuery() {
    error = null;
    loading = true;
    try {
      const res = await fetch('/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Query failed');
      result = data.data;
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
    <h1 class="text-xl font-semibold text-emphasis">SQL Workbench</h1>
    <p class="text-xs text-muted-foreground">MySQL-compatible query interface</p>
  </div>
  <Card>
    <CardHeader class="compact-card pb-3">
      <CardTitle class="text-sm">Query Editor</CardTitle>
    </CardHeader>
    <CardContent class="compact-card pt-0">
      <Textarea
        bind:value={sql}
        rows={8}
        class="font-mono text-xs mb-3 resize-y"
        ariaLabel="SQL query input"
      />
      <div class="flex gap-2">
        <Button on:click={runQuery} disabled={loading} class="text-xs h-8 px-3">
          {loading ? 'Running...' : 'Execute Query'}
        </Button>
        <Button variant="outline" on:click={() => navigate('/backup')} class="text-xs h-8 px-3">
          Backup
        </Button>
      </div>
    </CardContent>
  </Card>
  {#if error}
    <Card class="border-destructive">
      <CardContent class="compact-card">
        <div class="flex items-start gap-2">
          <span class="text-destructive font-medium text-xs" role="alert" aria-live="polite"
            >Error:</span
          >
          <span class="text-destructive text-xs">{error}</span>
        </div>
      </CardContent>
    </Card>
  {/if}
  {#if result}
    <Card>
      <CardHeader class="compact-card pb-3">
        <CardTitle class="text-sm">Query Results</CardTitle>
      </CardHeader>
      <CardContent class="compact-card pt-0">
        <pre
          class="text-xs overflow-auto max-h-[400px] bg-muted p-3 rounded-md"
          role="region"
          aria-label="Query results">{JSON.stringify(result, null, 2)}</pre>
      </CardContent>
    </Card>
  {/if}
</section>
