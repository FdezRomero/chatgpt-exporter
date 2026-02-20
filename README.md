# ChatGPT Exporter

A CLI tool to back up your ChatGPT conversations as JSON files and convert them to readable Markdown.

## Prerequisites

You need **Node.js 20+** installed on your machine.

- **macOS:** `brew install node` (requires [Homebrew](https://brew.sh/))
- **Windows/Linux:** download from [nodejs.org](https://nodejs.org/) instead
- Verify with: `node -v`

## Quick start

No installation needed — just run it with `npx`:

```bash
npx chatgpt-exporter backup --token "eyJhbG..."
```

## Getting your ChatGPT access token

This tool needs a ChatGPT access token from your browser session. Here's how to get it:

1. Open [chatgpt.com](https://chatgpt.com) and make sure you're logged in
2. In the same browser, go to: **[chatgpt.com/api/auth/session](https://chatgpt.com/api/auth/session)**
3. You'll see a JSON response — copy the value of `accessToken` (the long string starting with `eyJhbG...`)

> **Tip:** The token expires after a while. If you get an authentication error, just grab a fresh one.

You can pass the token directly or set it as an environment variable so you don't have to paste it every time:

```bash
export CHATGPT_TOKEN="eyJhbG..."
```

## Usage

### 1. Back up conversations

Downloads all your conversations (including projects) as JSON files:

```bash
npx chatgpt-exporter backup --token "eyJhbG..."
```

This creates a `chatgpt-export/` folder with JSON files and their Markdown equivalents:

```
chatgpt-export/
  conversations/
    index.json
    <conversation-id>.json
    <conversation-id>.md
    ...
  projects/
    <Project_Name>/
      conversations/
        index.json
        <conversation-id>.json
        <conversation-id>.md
        ...
  metadata.json
```

**Options:**

| Flag                  | Description                                | Default            |
| --------------------- | ------------------------------------------ | ------------------ |
| `-t, --token <token>` | Access token (or use `CHATGPT_TOKEN` env)  | —                  |
| `-o, --output <dir>`  | Output directory                           | `./chatgpt-export` |
| `--incremental`       | Only download new or updated conversations | `false`            |
| `--download-files`    | Download file attachments and images       | `false`            |
| `--project <name>`    | Only backup a specific project             | all                |
| `--concurrency <n>`   | Parallel downloads                         | `3`                |
| `--delay <ms>`        | Delay between API requests                 | `500`              |
| `-v, --verbose`       | Show detailed error messages               | `false`            |

### 2. List conversations

Preview your conversations without downloading them:

```bash
npx chatgpt-exporter list --token "eyJhbG..."
```

Add `--json` to get machine-readable output, or `--project <name>` to filter by project.

### 3. List projects

See all your ChatGPT projects:

```bash
npx chatgpt-exporter projects --token "eyJhbG..."
```

## Typical workflow

```bash
# First time: full export
npx chatgpt-exporter backup --token "eyJhbG..."

# Include uploaded images and file attachments
npx chatgpt-exporter backup --token "eyJhbG..." --download-files

# Later: only fetch what changed
npx chatgpt-exporter backup --token "eyJhbG..." --incremental --download-files
```

When using `--download-files`, files are saved to `chatgpt-export/files/` and Markdown files reference them with relative paths. Already-downloaded files are skipped on subsequent runs, and permanently unavailable files are remembered so they aren't retried.

## Troubleshooting

**"Authentication failed"** — Your token has expired. Grab a fresh one from [chatgpt.com/api/auth/session](https://chatgpt.com/api/auth/session).

**"Rate limit"** — ChatGPT is throttling requests. The tool retries automatically, but you can increase the delay: `--delay 1000`.

**Empty or short Markdown files** — This is normal for short conversations. The tool skips system messages and internal tool calls (like PDF parsing), so a conversation where you uploaded a file and got one response will produce a small `.md` with just your question and the answer.

## Privacy & Security

This tool runs entirely on your machine. It only communicates with OpenAI's servers (`chatgpt.com`) using your browser session token to access the same API that the ChatGPT web app uses. There is no telemetry, no analytics, no third-party services, and no data sent anywhere else. Your conversations and files are saved directly to your local filesystem.

## Development

To work on the tool locally:

```bash
git clone <repo-url>
cd chatgpt-exporter
npm install
npm run build
```

Run from source during development:

```bash
npm run dev -- backup --token "eyJhbG..."
```
