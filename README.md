# AI Review System

Automated code review system that analyzes Pull Requests using specialized AI agents and publishes structured feedback directly in the PR interface.

## Architecture

```
GitHub Webhook (PR opened/updated)
  └── Webhook Handler (HMAC validation)
        └── Orchestrator
              ├── GitHub API Client  → extracts diff
              ├── MCP Client         → fetches business rules from Jira (Atlassian MCP)
              ├── Agent Pool (parallel)
              │     ├── Bug Detection Agent
              │     ├── Code Smell Agent
              │     ├── Optimization Agent
              │     └── Business Logic Agent
              ├── Aggregator         → deduplicates + sorts by severity
              ├── GitHub API Client  → posts review comments on PR
              └── MongoDB Atlas      → saves audit log
```

## Stack

- **Node.js** + **Express**
- **Gemini API** (Google AI Studio) — LLM for all agents
- **Atlassian MCP** (`https://mcp.atlassian.com/v1/mcp`) — domain context from Jira
- **MongoDB Atlas** — audit log persistence
- **Octokit** — GitHub REST API client

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in all values in `.env` (see [Environment Variables](#environment-variables) below).

### 3. Run locally

```bash
npm run dev
```

Server starts at `http://localhost:4000`.
Health check: `GET /localhost:4000/health`

### 4. Expose locally with ngrok (optional)

```bash
ngrok http 4000
```

Use the generated HTTPS URL to configure the GitHub Webhook.

## Environment Variables

| Variable | Description |
|---|---|
| `GITHUB_TOKEN` | Personal access token with `repo` scope |
| `GITHUB_WEBHOOK_SECRET` | Secret configured in GitHub repository Webhook settings |
| `GEMINI_API_KEY` | API key from [Google AI Studio](https://aistudio.google.com) |
| `JIRA_EMAIL` | Atlassian account email |
| `JIRA_API_TOKEN` | Atlassian API token |
| `JIRA_PROJECT_KEY` | Jira project key (e.g., `SALA`) |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `PORT` | Server port (default: `4000`) |

## GitHub Webhook configuration

1. Go to the target repository → **Settings** → **Webhooks** → **Add webhook**
2. **Payload URL:** `https://your-render-url.onrender.com/webhook`
3. **Content type:** `application/json`
4. **Secret:** same value as `GITHUB_WEBHOOK_SECRET`
5. **Events:** select **Pull requests** only

## Agents

Each agent reads its instructions from `src/agents/prompts/` and calls the Gemini API independently. All four agents run in parallel via `Promise.all`.

| Agent | File | Focus |
|---|---|---|
| Bug Detection | `bug-agent.js` | Logical bugs, null dereferences, invalid state transitions |
| Code Smell | `smell-agent.js` | Magic numbers, duplicated logic, long functions |
| Optimization | `optimization-agent.js` | N+1 queries, sequential awaits, in-memory filtering |
| Business Logic | `business-logic-agent.js` | Compliance with business rules fetched from Jira via MCP |

### Customizing agent instructions

Edit the `.md` files in `src/agents/prompts/` to adapt agent behavior to the specific conventions of the target repository. These files are versioned in the repository (RF08).

## Audit log

Every review execution is persisted in MongoDB Atlas (`poc_review.audit_logs`) with the following schema:

```json
{
  "pr_number": 1,
  "repo": "owner/repo",
  "sha": "abc123",
  "agents": ["bug", "code_smell", "optimization", "business_logic"],
  "comments": [
    {
      "agent": "business_logic",
      "file": "src/services/reservation-service.js",
      "line": 31,
      "body": "Violation RN-03: duration check applies to all profiles...",
      "severity": "high"
    }
  ],
  "timestamp": "2026-06-10T10:00:00.000Z"
}
```

## Deploying to Render

1. Push this repository to GitHub
2. Create a new **Web Service** on [Render](https://render.com)
3. Connect the repository
4. Set **Start Command:** `npm start`
5. Add all environment variables from `.env.example`
6. Deploy

> **Note:** Render free tier sleeps after 15 minutes of inactivity. Use [UptimeRobot](https://uptimerobot.com) to ping `GET /health` every 5 minutes to keep the service alive.
