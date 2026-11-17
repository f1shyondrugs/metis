#!/usr/bin/env python3
"""Bounded, public social-video downloads for Metis; JSON output, no credentials."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[4]
ENV = ROOT / ".runtime/social-video-downloader"
DEFAULT_OUTPUT = ROOT / "data/social-video-downloads"
HOSTS = (
    "youtube.com", "youtu.be", "tiktok.com", "instagram.com", "vimeo.com",
    "twitch.tv", "x.com", "twitter.com", "facebook.com", "fb.watch",
    "reddit.com", "redd.it", "dailymotion.com", "dai.ly", "streamable.com",
)
FIELDS = ("id", "title", "extractor_key", "webpage_url", "duration", "uploader")

class DownloadError(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)

def normalize_url(value):
    value = value.strip()
    if any(ord(c) < 33 for c in value):
        raise DownloadError("invalid_url", "URL contains whitespace or control characters.")
    try:
        u = urlsplit(value)
        host = (u.hostname or "").lower()
        port = u.port
    except ValueError:
        raise DownloadError("invalid_url", "Malformed URL.") from None
    if u.scheme not in ("http", "https") or not host or u.username is not None or u.password is not None:
        raise DownloadError("invalid_url", "Use a public HTTP(S) video URL without credentials.")
    if port not in (None, 80, 443):
        raise DownloadError("invalid_url", "Nonstandard ports are not supported.")
    if not any(host == h or host.endswith("." + h) for h in HOSTS):
        raise DownloadError("unsupported_site", "Site is not enabled in this wrapper; inspect support before extending HOSTS.")
    query = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True)
             if not k.lower().startswith("utm_") and k.lower() not in ("igsh", "igshid", "si")]
    # A watch link with list= still refers to one video. Channel/feed-only links are not inputs.
    p = u.path.rstrip("/")
    if host.endswith("youtube.com") and (p in ("", "/playlist", "/feed", "/results")
                                        or p.startswith(("/channel/", "/c/", "/user/"))
                                        or (p.startswith("/@") and "/shorts/" not in p)):
        raise DownloadError("single_video_required", "Provide a video/Short link, not a channel, feed or playlist.")
    if host.endswith("instagram.com") and not p.startswith(("/p/", "/reel/", "/reels/", "/tv/", "/share/")):
        raise DownloadError("single_video_required", "Provide an Instagram post/Reel link, not a profile.")
    if host.endswith("tiktok.com") and (not p or (p.startswith("/@") and "/video/" not in p)):
        raise DownloadError("single_video_required", "Provide a TikTok video/share link, not a profile.")
    return urlunsplit((u.scheme.lower(), host, u.path or "/", urlencode(query), ""))

def run_process(command, timeout):
    # Only our own child process group is terminated on timeout, never any Metis service.
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, start_new_session=True)
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
    except (subprocess.TimeoutExpired, KeyboardInterrupt):
        os.killpg(proc.pid, signal.SIGKILL)
        proc.communicate()
        raise DownloadError("timeout", "Download exceeded its time limit or was interrupted.") from None
    return proc.returncode, stdout, stderr

def dependencies():
    ytdlp = ENV / "bin/yt-dlp"
    node = shutil.which("node")
    bundled_node = ROOT / ".runtime/node/bin/node"
    if bundled_node.is_file():
        node = str(bundled_node)
    return {"yt_dlp": str(ytdlp) if ytdlp.is_file() else None,
            "ffmpeg": shutil.which("ffmpeg"), "ffprobe": shutil.which("ffprobe"), "node": node}

def doctor():
    deps = dependencies()
    versions = {}
    for key, path in deps.items():
        if path:
            rc, out, err = run_process([path, "-version" if key in ("ffmpeg", "ffprobe") else "--version"], 15)
            versions[key] = (out or err).splitlines()[0] if rc == 0 else None
    return {"ok": all(deps.values()) and all(versions.values()), "dependencies": deps, "versions": versions}

def command_for(url, directory, height, probe, deps):
    limit = f"[height<=?{height}]" if height else ""
    fmt = f"bv[ext=mp4]{limit}+ba[ext=m4a]/b[ext=mp4]{limit}/bv{limit}+ba/b{limit}"
    command = [
        deps["yt_dlp"], "--ignore-config", "--no-plugin-dirs", "--no-remote-components",
        "--no-playlist", "--playlist-items", "1", "--no-progress", "--no-colors",
        "--socket-timeout", "20", "--retries", "2", "--fragment-retries", "2",
        "--extractor-retries", "1", "--concurrent-fragments", "4",
        "--match-filters", "!is_live", "--max-filesize", "1G",
        "--no-cache-dir", "--no-overwrites", "--restrict-filenames",
        "--trim-filenames", "160", "--format", fmt,
        "--no-js-runtimes", "--js-runtimes", "node:" + deps["node"],
    ]
    if probe:
        command += ["--simulate", "--dump-json"]
    else:
        command += [
            "--no-simulate", "--merge-output-format", "mp4/mkv",
            "--print", "after_move:%()j", "--output",
            str(directory / "%(extractor_key)s-%(id)s-%(title).100s.%(ext)s"),
        ]
    return command + ["--", url]

def error_code(message):
    lower = message.lower()
    if any(s in lower for s in ("sign in", "log in", "login", "cookies", "private video", "private account")):
        return "login_required"
    if any(s in lower for s in ("429", "too many requests", "rate limit")):
        return "rate_limited"
    if any(s in lower for s in ("403", "forbidden", "captcha", "cloudflare", "bot", "challenge", "blocked")):
        return "platform_blocked"
    if any(s in lower for s in ("not available", "unavailable", "removed", "404", "not found")):
        return "unavailable"
    return "download_failed"

def media_info(path):
    rc, out, err = run_process([
        shutil.which("ffprobe") or "ffprobe", "-v", "error",
        "-show_entries", "format=duration:stream=codec_type,codec_name,width,height",
        "-of", "json", str(path),
    ], 30)
    if rc:
        raise DownloadError("invalid_media", "ffprobe could not read the downloaded video.")
    data = json.loads(out)
    streams = data.get("streams", [])
    if not any(s.get("codec_type") == "video" for s in streams):
        raise DownloadError("invalid_media", "Downloaded file has no video stream.")
    return {"duration": data.get("format", {}).get("duration"), "streams": streams}

def atomic_json(path, value):
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".result-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

def cached_result(directory):
    try:
        data = json.loads((directory / "result.json").read_text())
        path = Path(data["file"]).resolve()
        if data.get("status") != "downloaded" or not path.is_relative_to(directory.resolve()):
            return None
        if not path.is_file() or path.stat().st_size != data["bytes"] or data["bytes"] <= 0:
            return None
        # Validate the actual file again; a stale/corrupt cache is not success.
        media_info(path)
        return dict(data, status="cached")
    except (OSError, KeyError, ValueError, DownloadError):
        return None

def download_one(raw_url, output, height=1080, timeout=600, probe=False, refresh=False):
    url = normalize_url(raw_url)
    deps = dependencies()
    if not all(deps.get(k) for k in ("yt_dlp", "ffmpeg", "ffprobe", "node")):
        raise DownloadError("missing_dependency", "Run this skill's scripts/setup.sh and check --doctor.")
    key = hashlib.sha256(json.dumps([url, height]).encode()).hexdigest()[:24]
    directory = output.resolve() / key
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Serializes duplicate requests without sharing an archive across concurrent jobs.
    with (directory / ".lock").open("a") as lock:
        started = time.monotonic()
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() - started > min(timeout, 30):
                    raise DownloadError("busy", "The same video is being downloaded by another job.")
                time.sleep(0.1)
        if not probe and not refresh:
            hit = cached_result(directory)
            if hit:
                return hit
        if not probe and shutil.disk_usage(directory).free < 2 * 1024**3:
            raise DownloadError("disk_full", "Less than 2 GiB free; no download started.")
        rc, stdout, stderr = run_process(command_for(url, directory, height, probe, deps), timeout)
        if rc:
            raise DownloadError(error_code(stderr), stderr.strip()[-1800:] or f"yt-dlp exited with {rc}.")
        items = []
        for line in stdout.splitlines():
            try:
                item = json.loads(line)
            except ValueError:
                continue
            if isinstance(item, dict):
                items.append(item)
        if len(items) != 1:
            raise DownloadError("no_video", "No single video returned (possibly live, filtered, oversized or unavailable).")
        info = items[0]
        result = {k: info.get(k) for k in FIELDS}
        result.update(source_url=url, max_height=height, status="probed" if probe else "downloaded")
        if not probe:
            path = Path(info.get("filepath") or "").resolve()
            if not path.is_relative_to(directory) or not path.is_file() or path.stat().st_size <= 0:
                raise DownloadError("missing_file", "yt-dlp did not produce a nonempty file in the download directory.")
            result.update(file=str(path), bytes=path.stat().st_size, media=media_info(path))
            atomic_json(directory / "result.json", result)
        return result

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("urls", nargs="*")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--height", type=int, default=1080, help="Maximum height; 0 for original/best.")
    parser.add_argument("--timeout", type=int, default=600, help="Seconds per input, including extraction.")
    parser.add_argument("--probe", action="store_true", help="Read metadata only; do not download video.")
    parser.add_argument("--refresh", action="store_true", help="Re-extract instead of using the local manifest.")
    parser.add_argument("--doctor", action="store_true", help="Check local dependencies, no network.")
    args = parser.parse_args(argv)
    if args.doctor:
        report = doctor()
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["ok"] else 1
    if not 0 <= args.height <= 8640 or not 1 <= args.timeout <= 3600 or not 1 <= len(args.urls) <= 20:
        parser.error("Provide 1–20 URLs, height 0–8640 and timeout 1–3600.")
    results = []
    for url in args.urls:
        try:
            results.append(download_one(url, args.output, args.height, args.timeout, args.probe, args.refresh))
        except DownloadError as error:
            results.append({"status": "error", "code": error.code, "message": str(error)})
        except (OSError, ValueError) as error:
            results.append({"status": "error", "code": "local_error", "message": str(error)})
    report = {"ok": all(r["status"] != "error" for r in results), "results": results}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1

if __name__ == "__main__":
    sys.exit(main())
