<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import Card from '$lib/components/ui/card/card.svelte';
  import CardHeader from '$lib/components/ui/card/card-header.svelte';
  import CardTitle from '$lib/components/ui/card/card-title.svelte';
  import CardContent from '$lib/components/ui/card/card-content.svelte';

  let status: string | null = null;
  let error: string | null = null;
  let loading = false;

  async function backupR2() {
    status = null;
    error = null;
    loading = true;
    try {
      const res = await fetch('/admin/backup/r2', { method: 'POST' });
      const data = await res.json();
      status = JSON.stringify(data);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function downloadLocal() {
    status = null;
    error = null;
    loading = true;
    try {
      const res = await fetch('/admin/backup/export');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'workersql-backup.json';
      a.click();
      status = 'Export downloaded successfully';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  // Default export for svelte-routing
</script>

<section class="compact-section">
  <div class="flex items-center justify-between mb-4">
    <h1 class="text-xl font-semibold text-emphasis">Backup & Restore</h1>
    <p class="text-xs text-muted-foreground">Data export and snapshot management</p>
  </div>
  <Card>
    <CardHeader class="compact-card pb-2">
      <CardTitle class="text-sm">Backup Options</CardTitle>
    </CardHeader>
    <CardContent class="compact-card pt-0">
      <div class="flex gap-2 flex-wrap">
        <Button on:click={backupR2} disabled={loading} class="text-xs h-8 px-3">
          {loading ? 'Processing...' : 'Backup to R2'}
        </Button>
        <Button
          variant="outline"
          on:click={downloadLocal}
          disabled={loading}
          class="text-xs h-8 px-3"
        >
          {loading ? 'Exporting...' : 'Local Export'}
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
  {#if status}
    <Card>
      <CardHeader class="compact-card pb-2">
        <CardTitle class="text-sm">Status</CardTitle>
      </CardHeader>
      <CardContent class="compact-card pt-0">
        <pre
          class="text-xs overflow-auto max-h-[200px] bg-muted p-3 rounded-md"
          role="region"
          aria-label="Backup status">{status}</pre>
      </CardContent>
    </Card>
  {/if}
</section>
