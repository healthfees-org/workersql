<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import Card from '$lib/components/ui/card/card.svelte';
  import CardHeader from '$lib/components/ui/card/card-header.svelte';
  import CardTitle from '$lib/components/ui/card/card-title.svelte';
  import CardContent from '$lib/components/ui/card/card-content.svelte';

  let sql = '';
  let result: unknown = null;
  let error: string | null = null;
  let loading = false;

  type ApiResponse = { success: boolean; data?: unknown; error?: string };

  async function exec(type: 'SELECT' | 'MUTATION' | 'DDL') {
    error = null;
    result = null;
    loading = true;
    try {
      const res = await fetch(
        type === 'SELECT' ? '/sql' : type === 'DDL' ? '/sql/ddl' : '/sql/mutation',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql }),
        }
      );
      const data: ApiResponse = await res.json();
      if (!res.ok || !data.success) throw new Error((data.error as string) || 'Failed');
      result = data.data as unknown;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }
</script>

<section class="compact-section">
  <div class="flex items-center justify-between mb-4">
    <h1 class="text-xl font-semibold text-emphasis">SQL Console</h1>
    <p class="text-xs text-muted-foreground">Advanced query execution</p>
  </div>
  <Card>
    <CardHeader class="compact-card pb-3">
      <CardTitle class="text-sm">Query Editor</CardTitle>
    </CardHeader>
    <CardContent class="compact-card pt-0">
      <Textarea
        bind:value={sql}
        rows={10}
        class="font-mono text-xs mb-3 resize-y"
        ariaLabel="SQL query input"
      />
      <div class="flex gap-2 flex-wrap">
        <Button on:click={() => exec('SELECT')} disabled={loading} class="text-xs h-8 px-3">
          SELECT
        </Button>
        <Button
          variant="secondary"
          on:click={() => exec('MUTATION')}
          disabled={loading}
          class="text-xs h-8 px-3"
        >
          MUTATION
        </Button>
        <Button
          variant="outline"
          on:click={() => exec('DDL')}
          disabled={loading}
          class="text-xs h-8 px-3"
        >
          DDL
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
        <CardTitle class="text-sm">Results</CardTitle>
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
