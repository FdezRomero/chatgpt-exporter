# Changelog

## 1.1.0

### Added

- `--download-files` flag to download file attachments and images referenced in conversations
- Two-step file download: fetches metadata from ChatGPT API, then downloads the actual file
- Downloaded files stored in `files/{fileId}/` with original filenames, deduplicated across conversations
- Markdown files reference local copies with relative paths when files are available
- Support for three file reference types: `image_asset_pointer`, `attachments`, and `citations`
- Progress bar with Downloaded/Skipped/Failed stats during file downloads
- Failed file IDs persisted in `metadata.json` to skip on subsequent incremental runs
- Errors grouped by message in output for cleaner reporting
- Privacy & Security section in README

### Fixed

- Pagination limit increased from 28 to 100 (the API maximum), reducing listing requests by ~3x
- `listProjectConversations` options made properly optional

## 1.0.0

### Added

- Full backup of all ChatGPT conversations and projects as JSON
- Automatic Markdown conversion with message threading
- Incremental backups (`--incremental`) — only downloads new or updated conversations
- Project support — backs up project conversations in separate directories
- Single project backup with `--project <name-or-id>`
- `list` command to preview conversations without downloading
- `projects` command to list all ChatGPT projects
- Configurable concurrency, delay, and output directory
- Retry with exponential backoff for rate limits and transient errors
- Progress bars for listing and downloading phases
- JSON output option for `list` and `projects` commands
