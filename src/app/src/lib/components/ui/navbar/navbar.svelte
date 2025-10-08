<script lang="ts">
  import { Link } from 'svelte-routing';
</script>

<nav
  class="border-b bg-card sticky top-0 z-50 backdrop-blur-sm bg-opacity-95"
  aria-label="Main navigation"
>
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="flex h-12 items-center justify-between gap-6">
      <div class="flex items-center gap-6">
        <a
          href="https://workersql.com"
          class="font-semibold text-primary text-sm tracking-tight hover:text-primary/80 transition-colors"
          aria-label="WorkerSQL Home"
        >
          WorkerSQL
        </a>
        <div class="hidden sm:flex items-center gap-4 text-sm">
          <Link
            to="/"
            class="text-muted-foreground hover:text-foreground transition-colors"
            aria-current="page"
          >
            Workbench
          </Link>
          <Link
            to="/database"
            class="text-muted-foreground hover:text-foreground transition-colors"
          >
            Database
          </Link>
          <Link
            to="/monitoring"
            class="text-muted-foreground hover:text-foreground transition-colors"
          >
            Monitoring
          </Link>
          <span class="text-border" aria-hidden="true">|</span>
          <Link to="/logs" class="text-muted-foreground hover:text-foreground transition-colors">
            Logs
          </Link>
          <Link
            to="/security"
            class="text-muted-foreground hover:text-foreground transition-colors"
          >
            Security
          </Link>
          <Link
            to="/migration"
            class="text-muted-foreground hover:text-foreground transition-colors"
          >
            Migration
          </Link>
          <Link to="/backup" class="text-muted-foreground hover:text-foreground transition-colors">
            Backup
          </Link>
        </div>
      </div>
      <div class="text-xs text-muted-foreground hidden md:block">
        <span
          class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-accent text-accent-foreground font-medium"
        >
          Admin
        </span>
      </div>
    </div>
  </div>
</nav>
