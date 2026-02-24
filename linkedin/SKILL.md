---
name: linkedin
description: General-purpose LinkedIn automation — fetch profiles, search people and companies, send messages, manage connections, create posts, and more. Use when the user wants to interact with LinkedIn.
---

# LinkedIn Skill

You have access to `linkedin` — a CLI tool for LinkedIn automation. Use it to fetch profiles, search people and companies, send messages, manage connections, create posts, react, comment, and more.

Each command sends a request to Linked API, which runs a real cloud browser to perform the action on LinkedIn. Operations are **not instant** — simple ones take ~10-20 seconds, complex ones longer.

## Authentication

Before using any command, authentication must be configured:

```bash
# Interactive setup
linkedin setup

# Non-interactive (for scripts / CI)
linkedin setup --linked-api-token=TOKEN --identification-token=TOKEN
```

Tokens are obtained at [app.linkedapi.io](https://app.linkedapi.io). Run `linkedin account list` to check configured accounts.

## Global Flags

Always use `--json` and `-q` for machine-readable output:

```bash
linkedin <command> --json -q
```

| Flag | Description |
|------|-------------|
| `--json` | Structured JSON output |
| `--quiet` / `-q` | Suppress stderr progress messages |
| `--fields name,url,...` | Select specific fields in output |
| `--account "Name"` | Use a specific account for this command |

## Output Format

Success:
```json
{"success": true, "data": {"name": "John Doe", "headline": "Engineer"}}
```

Error:
```json
{"success": false, "error": {"type": "personNotFound", "message": "Person not found"}}
```

Exit code 0 means the API call succeeded — always check the `success` field for the action outcome. Non-zero exit codes indicate infrastructure errors (auth, network, etc.).

## Commands

### Fetch a Person Profile

```bash
linkedin person fetch <url> [flags] --json -q
```

Optional flags to include additional data:
- `--experience` — work history
- `--education` — education history
- `--skills` — skills list
- `--languages` — languages
- `--posts` — recent posts (with `--posts-limit N`, `--posts-since TIMESTAMP`)
- `--comments` — recent comments (with `--comments-limit N`, `--comments-since TIMESTAMP`)
- `--reactions` — recent reactions (with `--reactions-limit N`, `--reactions-since TIMESTAMP`)

Only request additional data when needed — each flag increases execution time.

```bash
# Basic profile
linkedin person fetch https://www.linkedin.com/in/username --json -q

# With experience and education
linkedin person fetch https://www.linkedin.com/in/username --experience --education --json -q

# With last 5 posts
linkedin person fetch https://www.linkedin.com/in/username --posts --posts-limit 5 --json -q
```

### Search People

```bash
linkedin person search [flags] --json -q
```

| Flag | Description |
|------|-------------|
| `--term` | Search keyword or phrase |
| `--limit` | Max results |
| `--first-name` | Filter by first name |
| `--last-name` | Filter by last name |
| `--position` | Filter by job position |
| `--locations` | Comma-separated locations |
| `--industries` | Comma-separated industries |
| `--current-companies` | Comma-separated current company names |
| `--previous-companies` | Comma-separated previous company names |
| `--schools` | Comma-separated school names |

```bash
linkedin person search --term "product manager" --locations "San Francisco" --json -q
linkedin person search --current-companies "Google" --position "Engineer" --limit 20 --json -q
```

### Fetch a Company

```bash
linkedin company fetch <url> [flags] --json -q
```

Optional flags:
- `--employees` — include employees (with `--employees-limit`, `--employees-position`, `--employees-locations`, etc.)
- `--dms` — include decision makers (with `--dms-limit`)
- `--posts` — include company posts (with `--posts-limit`, `--posts-since`)

```bash
# Basic company info
linkedin company fetch https://www.linkedin.com/company/name --json -q

# With employees filtered by position
linkedin company fetch https://www.linkedin.com/company/name --employees --employees-position "Engineer" --json -q
```

### Search Companies

```bash
linkedin company search [flags] --json -q
```

| Flag | Description |
|------|-------------|
| `--term` | Search keyword |
| `--limit` | Max results |
| `--sizes` | Comma-separated sizes: `1-10`, `11-50`, `51-200`, `201-500`, `501-1000`, `1001-5000`, `5001-10000`, `10001+` |
| `--locations` | Comma-separated locations |
| `--industries` | Comma-separated industries |

```bash
linkedin company search --term "fintech" --sizes "11-50,51-200" --json -q
```

### Send a Message

```bash
linkedin message send <person-url> '<text>' --json -q
```

Text up to 1900 characters. Wrap the message in single quotes to avoid shell interpretation issues.

```bash
linkedin message send https://www.linkedin.com/in/username 'Hey, loved your latest post!' --json -q
```

### Get Conversation

```bash
linkedin message get <person-url> [--since TIMESTAMP] --json -q
```

The first call for a conversation triggers a background sync and may take longer. Subsequent calls are faster.

```bash
linkedin message get https://www.linkedin.com/in/username --json -q
linkedin message get https://www.linkedin.com/in/username --since 2024-01-15T10:30:00Z --json -q
```

### Connection Management

```bash
# Check connection status
linkedin connection status <url> --json -q

# Send connection request
linkedin connection send <url> [--note 'text'] [--email user@example.com] --json -q

# List connections (with optional filters)
linkedin connection list [--limit N] [--current-companies "..."] [--position "..."] --json -q

# List pending outgoing requests
linkedin connection pending --json -q

# Withdraw a pending request
linkedin connection withdraw <url> --json -q

# Remove a connection
linkedin connection remove <url> --json -q
```

### Posts

```bash
# Fetch a post (with optional comments and reactions)
linkedin post fetch <url> [--comments] [--reactions] --json -q

# Create a post
linkedin post create '<text>' [--attachments "url:type"] --json -q

# React to a post
linkedin post react <url> --type like --json -q
# Reaction types: like, love, support, celebrate, insightful, funny

# Comment on a post
linkedin post comment <url> '<text>' --json -q
```

Post creation supports attachments: up to 9 images, or 1 video, or 1 document. Format: `url:type` or `url:type:name`.

```bash
linkedin post create 'Check out our new report' --attachments "https://example.com/report.pdf:document:Q4 Report" --json -q
```

### Statistics

```bash
# Social Selling Index
linkedin stats ssi --json -q

# Performance analytics (profile views, post impressions, search appearances)
linkedin stats performance --json -q

# API usage for a date range
linkedin stats usage --start 2024-01-01T00:00:00Z --end 2024-01-31T00:00:00Z --json -q
```

### Sales Navigator

Requires a LinkedIn Sales Navigator subscription. Uses hashed URLs for person/company lookups.

```bash
# Fetch person
linkedin navigator person fetch <hashed-url> --json -q

# Search people (same filters as standard + --years-of-experience)
linkedin navigator person search --term "VP Marketing" --locations "United States" --json -q

# Fetch company (with optional --employees, --dms)
linkedin navigator company fetch <hashed-url> [--employees] [--dms] --json -q

# Search companies (same filters as standard + --revenue-min, --revenue-max)
linkedin navigator company search --term "fintech" --revenue-min 10 --revenue-max 100 --json -q

# Send InMail
linkedin navigator message send <person-url> '<text>' --subject 'Subject line' --json -q

# Get Sales Navigator conversation
linkedin navigator message get <person-url> --json -q
```

### Custom Workflows

Execute a custom workflow definition from a JSON file or stdin:

```bash
linkedin workflow run --file workflow.json --json -q
linkedin workflow status <id> --wait --json -q
```

### Account Management

```bash
linkedin account list                            # List accounts (* = active)
linkedin account switch "Name"                   # Switch active account
linkedin account rename "Name" --name "New Name" # Rename account
linkedin reset                                   # Remove active account
linkedin reset --all                             # Remove all accounts
```

## Important Behavior

- **Sequential execution.** All operations for an account run one at a time. Multiple requests queue up.
- **Not instant.** A real browser navigates LinkedIn — expect 10-20+ seconds per operation.
- **Timestamps in UTC.** All dates and times are in UTC.
- **Single quotes for text arguments.** Use single quotes around message text, post text, and comments to avoid shell interpretation issues with special characters.
- **Action limits.** Per-account limits are configurable on the platform. A `limitExceeded` error means the limit was reached.
