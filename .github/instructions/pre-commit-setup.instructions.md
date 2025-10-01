---
applyTo: '.pre-commit-config.yaml'
---

# Pre-commit Setup Documentation

## Overview
We use pre-commit for git hooks management to leverage its superior polyglot support and enterprise-grade features.

## Why Pre-commit over Husky

### Advantages of Pre-commit:
1. **Polyglot Support**: Native support for multiple languages (Python, TypeScript, PHP, etc.)
2. **Rich Ecosystem**: Extensive library of pre-built hooks for various tools
3. **Better Configuration**: YAML-based configuration that's more maintainable
4. **Security Features**: Built-in support for security scanning tools like Bandit
5. **Performance**: Better caching and parallel execution
6. **Enterprise Features**: More robust error handling and reporting

### Configuration Files:
- `.pre-commit-config.yaml`: Main configuration file
- `package.json`: Updated scripts to use pre-commit instead of husky

## Installation and Setup

### Prerequisites:
```bash
# Ensure Python virtual environment is activated
source .venv/Scripts/activate  # On Windows/WSL
# or
source .venv/bin/activate      # On Linux/macOS
```

### Installation:
```bash
# Install pre-commit (already done via Python package installer)
pip install pre-commit bandit

# Install git hooks
python -m pre_commit install
```

### Running Hooks:
```bash
# Run all hooks on all files
python -m pre_commit run --all-files

# Run hooks on staged files only
python -m pre_commit run

# Run specific hook
python -m pre_commit run eslint

# Update hook repositories
python -m pre_commit autoupdate
```

## Configured Hooks

### Security Hooks:
- `detect-private-key`: Prevents committing private keys
- `bandit`: Python security scanner for vulnerabilities

### Code Quality Hooks:
- `trailing-whitespace`: Removes trailing whitespace
- `end-of-file-fixer`: Ensures files end with newline
- `check-yaml`: Validates YAML syntax
- `check-json`: Validates JSON syntax
- `check-merge-conflict`: Detects merge conflict markers

### Language-Specific Hooks:
- `eslint`: TypeScript/JavaScript linting and auto-fixing
- `prettier`: Code formatting
- `typescript-check`: TypeScript compilation check
- `black`: Python code formatting (for SDK)
- `flake8`: Python linting (for SDK)

### File Management:
- `check-added-large-files`: Prevents large file commits
- `yamllint`: YAML file linting

## Package.json Changes

### Removed:
- `husky` dependency
- `lint-staged` configuration and dependency
- `precommit` script

### Added:
- `workflow:check` script for comprehensive validation
- Updated `prepare` script to install pre-commit hooks

### New Workflow Script:
```bash
npm run workflow:check
```
This runs: lint → format:check → test → build

## Migration Notes

### Git Configuration:
- Removed `core.hooksPath` configuration left by husky
- Pre-commit hooks installed to `.git/hooks/pre-commit`

### Benefits for Enterprise Development:
1. **Consistency**: Same tools across all languages in the project
2. **Security**: Automatic security scanning before commits
3. **Maintainability**: YAML configuration is easier to maintain than shell scripts
4. **Scalability**: Better performance with large codebases
5. **Compliance**: Better audit trail and reporting for enterprise requirements

## Troubleshooting

### Common Issues:
1. **Hook Installation Fails**: Ensure Python virtual environment is activated
2. **Permission Errors**: Check that .git/hooks directory is writable
3. **Tool Not Found**: Ensure all tools are installed in the environment

### Re-installation:
```bash
# If hooks need to be reinstalled
python -m pre_commit uninstall
python -m pre_commit install
```

## Best Practices

1. **Regular Updates**: Run `pre-commit autoupdate` monthly
2. **Local Testing**: Always test hooks locally before pushing
3. **Configuration Changes**: Test hook changes with `--all-files` flag
4. **Performance**: Use `--parallel` flag for faster execution on large repos
