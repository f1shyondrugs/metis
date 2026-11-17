#!/usr/bin/env python3
"""Offline behavioral checks; --integration adds real local HTTP/yt-dlp/FFmpeg tests."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("downloader", Path(__file__).with_name("download.py"))
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)

class DownloaderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        self.deps = {"yt_dlp": "/fake/yt-dlp", "node": "/fake/node",
                     "ffmpeg": "/fake/ffmpeg", "ffprobe": "/fake/ffprobe"}

    def test_major_sites_and_share_urls(self):
        for url in ("https://youtu.be/abc", "https://www.youtube.com/shorts/abc",
                    "https://www.tiktok.com/@user/video/123", "https://vm.tiktok.com/abc/",
                    "https://www.instagram.com/reel/abc/", "https://www.instagram.com/p/abc/",
                    "https://x.com/user/status/123", "https://vimeo.com/123",
                    "https://www.reddit.com/r/test/comments/123/test/",
                    "https://clips.twitch.tv/Test", "https://fb.watch/abc/",
                    "https://dai.ly/abc", "https://streamable.com/abc"):
            with self.subTest(url=url):
                self.assertTrue(d.normalize_url(url).startswith("https://"))

    def test_tracking_removed_but_video_identity_retained(self):
        result = d.normalize_url("https://www.youtube.com/watch?v=abc&si=tracking&utm_source=foo&list=PLx#t=1")
        self.assertEqual(result, "https://www.youtube.com/watch?v=abc&list=PLx")

    def test_reject_untrusted_inputs(self):
        for url in ("file:///etc/passwd", "https://127.0.0.1/a", "http://localhost/a",
                    "https://youtube.com.evil.org/watch?v=a", "--exec=touch /tmp/test",
                    "https://user:pass@youtube.com/watch?v=x", "https://youtube.com:8080/watch?v=a",
                    "https://youtube.com/\nwatch", "https://[bad"):
            with self.subTest(url=url), self.assertRaises(d.DownloadError):
                d.normalize_url(url)

    def test_reject_profiles_and_playlists(self):
        for url in ("https://www.youtube.com/playlist?list=PLx", "https://youtube.com/@user",
                    "https://www.instagram.com/username/", "https://www.tiktok.com/@user"):
            with self.subTest(url=url), self.assertRaises(d.DownloadError):
                d.normalize_url(url)

    def test_command_is_bounded_single_video_and_no_auth(self):
        cmd = d.command_for("https://youtu.be/x?a=1&b=2", self.root, 720, False, self.deps)
        for flag in ("--ignore-config", "--no-plugin-dirs", "--no-playlist", "--no-remote-components"):
            self.assertIn(flag, cmd)
        self.assertEqual(cmd[cmd.index("--playlist-items") + 1], "1")
        self.assertEqual(cmd[-2:], ["--", "https://youtu.be/x?a=1&b=2"])
        self.assertIn("height<=?720", cmd[cmd.index("--format") + 1])
        self.assertNotIn("--cookies", cmd)
        self.assertNotIn("--cookies-from-browser", cmd)
        self.assertNotIn("--exec", cmd)

    def test_best_original_has_no_height_cap(self):
        cmd = d.command_for("https://youtu.be/x", self.root, 0, False, self.deps)
        self.assertNotIn("height", cmd[cmd.index("--format") + 1])

    def test_probe_has_no_download_print(self):
        cmd = d.command_for("https://youtu.be/x", self.root, 1080, True, self.deps)
        self.assertIn("--simulate", cmd)
        self.assertIn("--dump-json", cmd)
        self.assertNotIn("--no-simulate", cmd)

    def test_dependency_failure_happens_before_download(self):
        with patch.object(d, "dependencies", return_value={}):
            with self.assertRaises(d.DownloadError) as cm:
                d.download_one("https://youtu.be/x", self.root)
        self.assertEqual(cm.exception.code, "missing_dependency")

    def test_error_classifications(self):
        for message, expected in (("Please log in", "login_required"),
                                  ("HTTP Error 429", "rate_limited"),
                                  ("HTTP Error 403 Forbidden", "platform_blocked"),
                                  ("Video unavailable", "unavailable"),
                                  ("unknown extraction error", "download_failed")):
            self.assertEqual(d.error_code(message), expected)

    def test_metadata_probe_returns_only_small_metadata(self):
        info = {"id": "x", "title": "Test", "url": "https://cdn.test/secret", "formats": [{"url": "secret"}]}
        with patch.object(d, "dependencies", return_value=self.deps), patch.object(
                d, "run_process", return_value=(0, json.dumps(info), "")):
            result = d.download_one("https://youtu.be/x", self.root, probe=True)
        self.assertEqual(result["status"], "probed")
        self.assertNotIn("formats", result)
        self.assertNotIn("url", result)
        self.assertFalse(list(self.root.glob("*/result.json")))

    def test_empty_filtered_result_is_not_success(self):
        with patch.object(d, "dependencies", return_value=self.deps), patch.object(
                d, "run_process", return_value=(0, "", "")):
            with self.assertRaises(d.DownloadError) as cm:
                d.download_one("https://youtu.be/x", self.root, probe=True)
        self.assertEqual(cm.exception.code, "no_video")

    def test_platform_error_is_not_success(self):
        with patch.object(d, "dependencies", return_value=self.deps), patch.object(
                d, "run_process", return_value=(1, "", "HTTP Error 403 Forbidden")):
            with self.assertRaises(d.DownloadError) as cm:
                d.download_one("https://youtu.be/x", self.root, probe=True)
        self.assertEqual(cm.exception.code, "platform_blocked")

    def test_missing_file_is_not_success(self):
        info = {"id": "x", "title": "Test", "filepath": str(self.root / "does-not-exist.mp4")}
        with patch.object(d, "dependencies", return_value=self.deps), patch.object(
                d, "run_process", return_value=(0, json.dumps(info), "")), patch.object(
                d.shutil, "disk_usage", return_value=type("Disk", (), {"free": 10 * 1024**3})()):
            with self.assertRaises(d.DownloadError) as cm:
                d.download_one("https://youtu.be/x", self.root)
        self.assertEqual(cm.exception.code, "missing_file")

    def test_cache_requires_real_file_and_valid_size(self):
        video = self.root / "video.mp4"
        video.write_bytes(b"fixture")
        record = {"status": "downloaded", "file": str(video), "bytes": 7}
        d.atomic_json(self.root / "result.json", record)
        with patch.object(d, "media_info", return_value={}):
            self.assertEqual(d.cached_result(self.root)["status"], "cached")
            video.write_bytes(b"changed size")
            self.assertIsNone(d.cached_result(self.root))

    def test_cache_refuses_outside_path(self):
        d.atomic_json(self.root / "result.json", {"status": "downloaded", "file": "/etc/passwd", "bytes": 1})
        self.assertIsNone(d.cached_result(self.root))

    def test_cache_refuses_invalid_media(self):
        video = self.root / "video.mp4"
        video.write_bytes(b"not a video")
        d.atomic_json(self.root / "result.json", {"status": "downloaded", "file": str(video), "bytes": video.stat().st_size})
        with patch.object(d, "media_info", side_effect=d.DownloadError("invalid_media", "bad")):
            self.assertIsNone(d.cached_result(self.root))

    def test_timeout_terminates_own_child(self):
        with self.assertRaises(d.DownloadError) as cm:
            d.run_process([sys.executable, "-c", "import time; time.sleep(30)"], 0.1)
        self.assertEqual(cm.exception.code, "timeout")

    def test_batch_retains_success_and_failure(self):
        buf = io.StringIO()
        with patch.object(d, "download_one", side_effect=[
                {"status": "cached", "file": "/test.mp4"}, d.DownloadError("unavailable", "removed")
        ]), redirect_stdout(buf):
            rc = d.main(["https://youtu.be/a", "https://youtu.be/b"])
        data = json.loads(buf.getvalue())
        self.assertEqual(rc, 1)
        self.assertFalse(data["ok"])
        self.assertEqual(data["results"][0]["status"], "cached")
        self.assertEqual(data["results"][1]["code"], "unavailable")

class LocalIntegrationTests(unittest.TestCase):
    def test_real_download_probe_cache_and_corruption(self):
        import functools
        from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
        import threading
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            source.mkdir()
            fixture = source / "fixture.mp4"
            subprocess.run([
                "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=10",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
                "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(fixture),
            ], check=True, timeout=30)
            class Handler(SimpleHTTPRequestHandler):
                def log_message(self, *args):
                    pass
            server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(source)))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                url = f"http://127.0.0.1:{server.server_port}/fixture.mp4"
                # Test-only local transport; production URL validation remains unmodified.
                with patch.object(d, "normalize_url", side_effect=lambda value: value):
                    probe = d.download_one(url, root / "output", probe=True, timeout=60)
                    self.assertEqual(probe["status"], "probed")
                    result = d.download_one(url, root / "output", timeout=60)
                    self.assertEqual(result["status"], "downloaded")
                    self.assertGreater(result["bytes"], 0)
                    self.assertTrue(any(s["codec_type"] == "audio" for s in result["media"]["streams"]))
                    cached = d.download_one(url, root / "output", timeout=60)
                    self.assertEqual(cached["status"], "cached")
                    self.assertEqual(result["file"], cached["file"])
                    Path(result["file"]).write_bytes(b"corrupt")
                    self.assertIsNone(d.cached_result(Path(result["file"]).parent))
                    with self.assertRaises(d.DownloadError):
                        d.download_one(url, root / "output", timeout=60)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

if __name__ == "__main__":
    integration = "--integration" in sys.argv
    suite = unittest.TestLoader().loadTestsFromTestCase(DownloaderTests)
    if integration:
        suite.addTests(unittest.TestLoader().loadTestsFromTestCase(LocalIntegrationTests))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
