<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import Card from '$lib/components/ui/card/card.svelte';
  import CardHeader from '$lib/components/ui/card/card-header.svelte';
  import CardTitle from '$lib/components/ui/card/card-title.svelte';
  import CardContent from '$lib/components/ui/card/card-content.svelte';
  import Table from '$lib/components/ui/table/table.svelte';
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';

  let tables: string[] = [];
  let selectedTable: string | null = null;
  let tableData: any[] = [];
  let tableSchema: any[] = [];
  let loading = false;
  let error: string | null = null;

  async function loadTables() {
    loading = true;
    error = null;
    try {
      const r = await fetch('/database/tables');
      const data = await r.json();
      if (data.success) {
        tables = data.data;
      } else {
        error = data.error || 'Failed to load tables';
      }
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function loadTableData(tableName: string) {
    loading = true;
    error = null;
    selectedTable = tableName;
    try {
      // Load schema
      const schemaRes = await fetch(`/database/schema/${tableName}`);
      const schemaData = await schemaRes.json();
      if (schemaData.success) {
        tableSchema = schemaData.data;
      }

      // Load data (first 100 rows)
      const dataRes = await fetch(`/database/data/${tableName}?limit=100`);
      const tableDataResult = await dataRes.json();
      if (tableDataResult.success) {
        tableData = tableDataResult.data;
      } else {
        error = tableDataResult.error || 'Failed to load table data';
      }
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  // Load tables on mount
  loadTables();
</script>

<section class="compact-section">
  <div class="flex items-center justify-between mb-4">
    <h1 class="text-xl font-semibold text-emphasis">Database Browser</h1>
    <Button on:click={loadTables} disabled={loading} variant="outline" class="text-xs h-8 px-3">
      {loading ? 'Loading...' : 'Refresh'}
    </Button>
  </div>

  {#if error}
    <Card class="border-destructive mb-4">
      <CardContent class="compact-card">
        <div class="text-destructive text-xs" role="alert" aria-live="polite">{error}</div>
      </CardContent>
    </Card>
  {/if}

  <div class="grid md:grid-cols-3 gap-4">
    <!-- Tables List -->
    <Card>
      <CardHeader class="compact-card pb-2">
        <CardTitle class="text-sm">Tables</CardTitle>
      </CardHeader>
      <CardContent class="compact-card pt-0">
        {#if loading && tables.length === 0}
          <div class="space-y-2">
            <Skeleton class="h-6 w-full" />
            <Skeleton class="h-6 w-full" />
            <Skeleton class="h-6 w-full" />
          </div>
        {:else}
          <div class="space-y-1 max-h-[400px] overflow-y-auto">
            {#each tables as table}
              <button
                class="w-full text-left px-2 py-1 text-xs rounded hover:bg-accent transition-colors {selectedTable ===
                table
                  ? 'bg-accent font-medium'
                  : ''}"
                on:click={() => loadTableData(table)}
              >
                {table}
              </button>
            {/each}
          </div>
        {/if}
      </CardContent>
    </Card>

    <!-- Table Schema -->
    <Card>
      <CardHeader class="compact-card pb-2">
        <CardTitle class="text-sm">Schema {selectedTable ? `(${selectedTable})` : ''}</CardTitle>
      </CardHeader>
      <CardContent class="compact-card pt-0">
        {#if !selectedTable}
          <div class="text-muted-foreground text-xs">Select a table to view schema</div>
        {:else if loading}
          <div class="space-y-2">
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-full" />
          </div>
        {:else}
          <Table
            columns={[
              { key: 'name', header: 'Column' },
              { key: 'type', header: 'Type' },
              { key: 'notnull', header: 'Required' },
              { key: 'pk', header: 'Primary Key' },
            ]}
            items={tableSchema.map((col) => ({
              name: col.name,
              type: col.type,
              notnull: col.notnull ? 'Yes' : 'No',
              pk: col.pk ? 'Yes' : 'No',
            }))}
            class="text-xs"
          />
        {/if}
      </CardContent>
    </Card>

    <!-- Table Data -->
    <Card>
      <CardHeader class="compact-card pb-2">
        <CardTitle class="text-sm">Data {selectedTable ? `(${selectedTable})` : ''}</CardTitle>
      </CardHeader>
      <CardContent class="compact-card pt-0">
        {#if !selectedTable}
          <div class="text-muted-foreground text-xs">Select a table to view data</div>
        {:else if loading}
          <div class="space-y-2">
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-full" />
          </div>
        {:else if tableData.length === 0}
          <div class="text-muted-foreground text-xs">No data in table</div>
        {:else}
          <div class="max-h-[400px] overflow-y-auto">
            <Table
              columns={tableSchema.map((col) => ({ key: col.name, header: col.name }))}
              items={tableData}
              class="text-xs"
            />
          </div>
          {#if tableData.length >= 100}
            <div class="text-xs text-muted-foreground mt-2">Showing first 100 rows</div>
          {/if}
        {/if}
      </CardContent>
    </Card>
  </div>
</section>
