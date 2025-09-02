# Local Development Setup Guide

This guide will help you set up a complete local development environment for the
Edge MySQL Gateway project.

## Prerequisites

Before starting, ensure you have the following installed:

- **Node.js** (v18 or later) with npm
- **Git** for version control
- **Wrangler CLI** for Cloudflare Workers development
- **Python 3.8+** (for SDK development and security scanning)

### Install Required Tools

```bash
# Install Node.js (if not already installed)
# Visit https://nodejs.org/ or use a version manager like nvm

# Install Wrangler CLI globally
npm install -g wrangler

# Verify installations
node --version
npm --version
wrangler --version
```

## Project Setup

### 1. Clone and Install Dependencies

```bash
# Clone the repository
git clone https://github.com/healthfees-org/workersql.git
cd workersql

# Install Node.js dependencies
npm install

# Set up Python virtual environment (for development tools)
python -m venv .venv

# Activate virtual environment
# On Windows:
.venv\Scripts\activate
# On macOS/Linux:
source .venv/bin/activate

# Install Python dependencies
pip install -r requirements-dev.txt
```

### 2. Configure Wrangler

```bash
# Authenticate with Cloudflare (required for deployment)
wrangler auth login

# Copy the wrangler configuration template
cp wrangler.toml.template wrangler.toml
```

### 3. Set Up Cloudflare Resources

#### Create KV Namespace for Caching

```bash
# Create the main KV namespace
wrangler kv:namespace create "APP_CACHE"

# Create a preview namespace for development
wrangler kv:namespace create "APP_CACHE" --preview

# Note the namespace IDs and update wrangler.toml
```

#### Create Queue for Event Processing

```bash
# Create the main event queue
wrangler queues create db-events

# Create dead letter queue for failed events
wrangler queues create db-events-dlq
```

#### Create D1 Database (Optional)

```bash
# Create D1 database for portable data mirror
wrangler d1 create portable-mirror

# Note the database ID and update wrangler.toml
```

### 4. Update Configuration

Edit `wrangler.toml` with the IDs from the previous step:

```toml
[[kv_namespaces]]
binding = "APP_CACHE"
id = "YOUR_KV_NAMESPACE_ID"
preview_id = "YOUR_PREVIEW_NAMESPACE_ID"

[[d1_databases]]
binding = "PORTABLE_DB"
database_name = "portable-mirror"
database_id = "YOUR_D1_DATABASE_ID"
```

### 5. Set Development Secrets

```bash
# Set JWT secret for authentication
echo "dev-jwt-secret-$(date +%s)" | wrangler secret put JWT_SECRET

# Set database encryption key
echo "dev-encryption-key-$(date +%s)" | wrangler secret put DATABASE_ENCRYPTION_KEY

# Set admin API key
echo "dev-admin-key-$(date +%s)" | wrangler secret put ADMIN_API_KEY
```

## Development Workflow

### 1. Build the Project

```bash
# TypeScript compilation
npm run build

# Verify the build succeeded
ls -la dist/
```

### 2. Run Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test suites
npm run test:unit
npm run test:integration

# Watch mode for development
npm run test:watch
```

### 3. Code Quality Checks

```bash
# Run linting
npm run lint

# Fix linting issues automatically
npm run lint:fix

# Check code formatting
npm run format:check

# Format code automatically
npm run format

# Run all quality checks
npm run workflow:check
```

### 4. Local Development Server

```bash
# Start local development server
npm run dev

# This will start Wrangler in development mode with hot reload
# The server will be available at http://localhost:8787
```

### 5. Pre-commit Hooks

The project uses pre-commit hooks to ensure code quality:

```bash
# Install pre-commit hooks (run once)
npm run prepare

# Test pre-commit hooks manually
pre-commit run --all-files
```

## Testing Your Setup

### 1. Health Check

Test that your local server is working:

```bash
# Start the development server
npm run dev

# In another terminal, test the health endpoint
curl http://localhost:8787/health
```

### 2. SQL Query Test

Test a simple SQL query:

```bash
curl -X POST http://localhost:8787/sql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token-12345" \
  -d '{
    "sql": "SELECT 1 as test",
    "params": []
  }'
```

### 3. Cache Test

Test the caching functionality:

```bash
# First request (should miss cache)
curl -X POST http://localhost:8787/sql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token-12345" \
  -d '{
    "sql": "SELECT * FROM users LIMIT 10",
    "params": []
  }'

# Second request (should hit cache)
curl -X POST http://localhost:8787/sql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token-12345" \
  -d '{
    "sql": "SELECT * FROM users LIMIT 10",
    "params": []
  }'
```

## Environment Variables

For local development, you can create a `.env.local` file:

```bash
# Create local environment file
cat > .env.local << EOF
ENVIRONMENT=development
LOG_LEVEL=debug
MAX_SHARD_SIZE_GB=1
CACHE_TTL_MS=5000
CACHE_SWR_MS=10000
SHARD_COUNT=4
EOF
```

## Debugging

### 1. Enable Debug Logging

Set `LOG_LEVEL=debug` in your `wrangler.toml`:

```toml
[env.development.vars]
LOG_LEVEL = "debug"
```

### 2. Inspect KV Store

```bash
# List all keys in your KV namespace
wrangler kv:key list --binding APP_CACHE

# Get a specific key value
wrangler kv:key get "cache-key" --binding APP_CACHE

# Delete a key
wrangler kv:key delete "cache-key" --binding APP_CACHE
```

### 3. Monitor Queue Messages

```bash
# View queue consumer logs
wrangler tail --format pretty

# Send test message to queue
wrangler queues producer send db-events '{"type":"test","data":"hello"}'
```

### 4. D1 Database Operations

```bash
# Execute SQL on D1 database
wrangler d1 execute portable-mirror --command "SELECT 1"

# Import SQL file
wrangler d1 execute portable-mirror --file schema.sql

# Export database
wrangler d1 export portable-mirror --output backup.sql
```

## IDE Setup

### VS Code Configuration

Create `.vscode/settings.json`:

```json
{
  "typescript.preferences.importModuleSpecifier": "relative",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "eslint.workingDirectories": ["src", "tests"],
  "files.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/.git": true
  }
}
```

### Recommended Extensions

- TypeScript and JavaScript Language Features
- ESLint
- Prettier - Code formatter
- Cloudflare Workers
- Thunder Client (for API testing)

## Troubleshooting

### Common Issues

1. **"wrangler not found"**

   ```bash
   npm install -g wrangler
   ```

2. **"Authentication required"**

   ```bash
   wrangler auth login
   ```

3. **"KV namespace not found"**
   - Check that you've created the KV namespace
   - Verify the namespace ID in `wrangler.toml`

4. **"Build failed"**

   ```bash
   # Clean and rebuild
   rm -rf dist node_modules
   npm install
   npm run build
   ```

5. **Tests failing**
   ```bash
   # Check if Miniflare is properly configured
   npm run test:unit -- --verbose
   ```

### Getting Help

- Check the
  [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/)
- Review the
  [Wrangler CLI documentation](https://developers.cloudflare.com/workers/wrangler/)
- Look at existing tests in the `tests/` directory for examples
- Check the project's GitHub issues for known problems

## Next Steps

Once your local environment is set up:

1. **Explore the Architecture**: Review `docs/architecture.md`
2. **Run the Test Suite**: Ensure all tests pass with `npm test`
3. **Make Changes**: Edit code in the `src/` directory
4. **Test Changes**: Use `npm run dev` and test your changes
5. **Submit PRs**: Follow the contribution guidelines

## Production Deployment

When ready to deploy:

```bash
# Deploy to staging
wrangler deploy --env staging

# Deploy to production
wrangler deploy --env production
```

Remember to set production secrets and update configuration for production
workloads.
