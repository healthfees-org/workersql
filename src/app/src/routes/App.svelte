<script lang="ts">
  import { Router, Route } from 'svelte-routing';
  import Home from './Home.svelte';
  import Query from './Query.svelte';
  import Database from './Database.svelte';
  import Monitoring from './Monitoring.svelte';
  import Logs from './Logs.svelte';
  import Security from './Security.svelte';
  import Migration from './Migration.svelte';
  import Backup from './Backup.svelte';
  import { onMount } from 'svelte';
  import Navbar from '../lib/components/ui/navbar/navbar.svelte';

  let me: { authenticated: boolean; tenantId?: string; userId?: string; permissions?: string[] } = {
    authenticated: false,
  };
  let isAdmin = false;
  onMount(async () => {
    try {
      const r = await fetch('/auth/me');
      const data = (await r.json()) as typeof me;
      me = data;
      isAdmin =
        Array.isArray(me.permissions) &&
        me.permissions.some((p) => String(p).toLowerCase().includes('admin'));
    } catch {
      /* ignore */
    }
  });
</script>

<Router>
  <Navbar />

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
    <Route path="/" component={Home} />
    <Route path="/query" component={Query} />
    <Route path="/database" component={Database} />
    <Route path="/monitoring" component={Monitoring} />
    <Route path="/logs" component={Logs} />
    <Route path="/security" component={Security} />
    <Route path="/migration" component={Migration} />
    <Route path="/backup" component={Backup} />
  </main>
</Router>
