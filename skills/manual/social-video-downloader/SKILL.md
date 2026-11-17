---
name: social-video-downloader
description: Download user-provided public video links from TikTok, Instagram Reels, YouTube/Shorts and similar social sites for local analysis or editing. Use when the actual video file is needed, not for ordinary webpage research, profile crawling or publishing.
---

# Social video downloader

Use the maintained yt-dlp engine through this tested wrapper, not ad-filled third-party downloader websites. It runs on the Metis server and does not modify or restart the app.

## Commands

From /root/metis-ai:

```bash
python3 skills/manual/social-video-downloader/scripts/download.py -- 'VIDEO_URL'
python3 skills/manual/social-video-downloader/scripts/download.py -- 'URL_1' 'URL_2'
python3 skills/manual/social-video-downloader/scripts/download.py --probe -- 'VIDEO_URL'
python3 skills/manual/social-video-downloader/scripts/download.py --height 0 -- 'VIDEO_URL'
python3 skills/manual/social-video-downloader/scripts/download.py --doctor
```

Quote each URL as a shell argument (use a proper quoting function when constructing commands); do not interpolate raw URL text into a command. Execute using the normal Metis command tool with a timeout longer than the wrapper's --timeout (default 600 seconds per input). For batches exceeding a tool's maximum time, split into smaller calls.

- Default: at most one video per link, maximum 1080p, prefer MP4 without transcoding, native fallback if necessary. --height 0 requests best/original resolution. A carousel returns its first video only; do not describe it as the entire post.
- Supported wrapper hosts: YouTube, TikTok, Instagram, Vimeo, Twitch, X/Twitter, Facebook, Reddit, Dailymotion and Streamable, including their common share domains. Host support is not a guarantee that a particular video is accessible.
- Output is JSON: ok, results; statuses downloaded, cached, probed or error. A failed item makes exit code 1; successful batch items remain available. Only downloaded/cached with a real file is a successful download.
- Files and small metadata manifests are in data/social-video-downloads/<request hash>/. Cache is resolution-aware and ffprobe-validated. --output selects another server folder; --refresh re-extracts (does not delete/overwrite existing complete files). There is no automatic retention deletion.
- Extraction retries are bounded; 600-second total timeout per input, 1 GiB yt-dlp filesize filter (not a hard aggregate disk quota), 2 GiB free-space check. Live streams are excluded. No profile/playlist crawling.
- On success use the returned file with the relevant media-analysis/editing tools and continue the user's actual task. Retrieval alone is not watching/analyzing. When the user wants the file attached, use provide_file.

## Access limits and maintenance

Public URLs only: no cookies, browser-profile extraction, passwords or tokens are accepted. A login_required, rate_limited or platform_blocked result must be reported honestly. Stop on challenges; never try alternate identities, proxies or challenge bypasses. A protected browser login does not grant this shell script a browser session. If no supported secure media handoff exists, request a direct video upload instead.

If dependencies are missing: bash skills/manual/social-video-downloader/scripts/setup.sh. Isolated Python/yt-dlp lives in .runtime/social-video-downloader; FFmpeg/FFprobe are existing system executables; Node is detected from .runtime/node/bin/node or PATH. System yt-dlp is left untouched.

For extractor breakage, check the official yt-dlp documentation, update only this isolated environment when justified, test one known public link, and record the working dependency versions in requirements.txt. Do not keep retrying a platform block or claim all platforms passed from local unit tests.

Reference: https://github.com/yt-dlp/yt-dlp (maintained downloader and CLI documentation).
