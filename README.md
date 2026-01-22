# Kreuzberg Batch Processor

A Docker-based batch processing pipeline for document extraction using [Kreuzberg](https://github.com/kreuzberg-dev/kreuzberg).

## Features

- **Automatic File Watching**: Monitors input directory for new files
- **Recursive Folder Processing**: Process entire folder structures with preserved hierarchy
- **3-Layer URL Fetching**: Native fetch → Playwright → Browserless fallback
- **Smart Deduplication**: MD5 hash-based tracking to skip already processed files
- **Concurrent Processing**: Configurable parallel extraction jobs
- **Retry Logic**: Automatic retries with configurable attempts
- **Error Handling**: Failed files moved to error directory with logs

## Quick Start

1. **Copy environment file**:
   ```bash
   cp .env.example .env
   ```

2. **Start the service**:
   ```bash
   # Without browserless (Layer 1 & 2 only)
   docker compose up -d kreuzberg-batch

   # With browserless (all 3 layers)
   docker compose --profile with-browserless up -d
   ```

3. **Add files to process**:
   - Drop files into `files/input/`
   - Or add URLs to `files/input/urls.txt`

4. **Check output**:
   - Processed markdown files appear in `files/output/`
   - Failed files are moved to `files/error/`

## Directory Structure

```
kreuzberg/
├── docker-compose.yml      # Service orchestration
├── Dockerfile              # Custom image with Bun + Playwright
├── .env                    # Configuration (copy from .env.example)
├── config/
│   └── kreuzberg.toml     # Kreuzberg extraction settings
├── scripts/                # TypeScript processing logic
│   ├── main.ts            # Entry point
│   ├── fetcher.ts         # 3-layer URL fetching
│   ├── processor.ts       # Document extraction
│   ├── watcher.ts         # File system watcher
│   ├── hash.ts            # MD5 hash management
│   └── ...
└── files/                  # Data directory (mounted as volume)
    ├── input/             # Source files and urls.txt
    ├── output/            # Processed markdown
    └── error/             # Failed files with error logs
```

## Configuration

All configuration is done via environment variables in `.env`:

### Watch Settings
| Variable | Default | Description |
|----------|---------|-------------|
| `WATCH_INTERVAL` | `30` | Seconds between directory scans |
| `CONCURRENT_JOBS` | `4` | Parallel processing jobs |
| `RECURSIVE` | `true` | Process subdirectories |

### URL Fetching
| Variable | Default | Description |
|----------|---------|-------------|
| `FETCH_URLS` | `true` | Enable URL fetching from urls.txt |
| `PLAYWRIGHT_ENABLED` | `true` | Enable Playwright (Layer 2) |
| `BROWSERLESS_ENABLED` | `true` | Enable Browserless (Layer 3) |
| `BROWSERLESS_TOKEN` | `` | API token for Browserless |

### Error Handling
| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_RETRIES` | `3` | Retry attempts before failing |
| `RETRY_DELAY` | `5000` | Delay between retries (ms) |

See `.env.example` for all available options.

## URL File Format

Create `files/input/urls.txt`:

```
# Comments start with #
https://example.com/page1
https://example.com/page2 custom-filename
https://docs.example.com/api
```

Format: `URL [optional_custom_filename]`

## Supported Formats

- **Documents**: PDF, DOCX, DOC, PPTX, PPT, XLSX, XLS, ODT, RTF, EPUB
- **Web**: HTML, XML, JSON, YAML, TOML
- **Images** (OCR): PNG, JPG, TIFF, BMP, GIF, WEBP
- **Text**: TXT, MD, Markdown
- **Email**: EML, MSG
- **Archives**: ZIP, TAR, GZ

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Compose                            │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐    ┌─────────────────────┐         │
│  │  kreuzberg-batch    │    │    browserless      │         │
│  │  ─────────────────  │    │  ─────────────────  │         │
│  │  • Bun runtime      │───▶│  • Chrome headless  │         │
│  │  • Playwright       │    │  • REST API         │         │
│  │  • Kreuzberg CLI    │    │                     │         │
│  └─────────────────────┘    └─────────────────────┘         │
│           │                                                  │
│           ▼                                                  │
│  ┌─────────────────────────────────────────────────┐        │
│  │                   /files (volume)                │        │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐         │        │
│  │  │ input/  │  │ output/ │  │ error/  │         │        │
│  │  └─────────┘  └─────────┘  └─────────┘         │        │
│  └─────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## 3-Layer URL Fetching

1. **Layer 1: Native Fetch** - Fast, lightweight, for static HTML
2. **Layer 2: Playwright** - For JavaScript-rendered pages
3. **Layer 3: Browserless** - REST API fallback for complex pages

Each layer falls back to the next if it fails.

## License

MIT
