"""Tests for tools/save_server.py:  python -I tools/test_save_server.py -v."""
import http.client
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 64
JPG = b"\xff\xd8\xff\xe0" + b"\0" * 64
WEBP = b"RIFF\0\0\0\0WEBPVP8 " + b"\0" * 64


def multipart(files, back=None):
    boundary = "tcBoundary7MA4YWxk"
    out = b""
    for name, data in files:
        out += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
                f"Content-Type: application/octet-stream\r\n\r\n").encode() + data + b"\r\n"
    if back is not None:
        out += f"--{boundary}\r\nContent-Disposition: form-data; name=\"back\"\r\n\r\n{back}\r\n".encode()
    out += f"--{boundary}--\r\n".encode()
    return out, f"multipart/form-data; boundary={boundary}"


class SaveServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = self.tmp.name
        self.proc = subprocess.Popen([sys.executable, "-I", str(HERE / "save_server.py"), "--out", self.out],
                                     stdout=subprocess.PIPE, text=True)
        ready = json.loads(self.proc.stdout.readline())
        self.assertTrue(ready["ready"])
        self.url = urllib.parse.urlparse(ready["url"])
        self.assertEqual(self.url.hostname, "127.0.0.1")

    def tearDown(self):
        self.proc.terminate()
        self.proc.wait(5)
        self.proc.stdout.close()
        self.tmp.cleanup()

    def post(self, files, back=None, path=None):
        body, ctype = multipart(files, back)
        c = http.client.HTTPConnection(self.url.hostname, self.url.port, timeout=5)
        c.request("POST", path or self.url.path, body, {"Content-Type": ctype})
        r = c.getresponse()
        r.read()
        c.close()
        return r.status, r.getheader("Location")

    def events(self, n):
        return [json.loads(self.proc.stdout.readline()) for _ in range(n)]

    def test_saves_png_and_redirects_back_to_the_chat(self):
        status, loc = self.post([("moodboard.png", PNG)], back="https://chatgpt.com/c/abc")
        self.assertEqual((status, loc), (303, "https://chatgpt.com/c/abc"))
        self.assertEqual(self.events(1), [{"saved": "moodboard.png", "bytes": len(PNG)}])
        self.assertEqual(pathlib.Path(self.out, "moodboard.png").read_bytes(), PNG)

    def test_existing_file_is_kept_and_new_one_is_numbered(self):
        self.post([("a.png", PNG)], back="https://chatgpt.com/")
        self.post([("a.png", PNG)], back="https://chatgpt.com/")
        self.assertEqual([e["saved"] for e in self.events(2)], ["a.png", "a-2.png"])

    def test_extension_follows_the_bytes_not_the_name(self):
        self.post([("photo.png", JPG), ("pic", WEBP)], back="https://chatgpt.com/")
        self.assertEqual([e["saved"] for e in self.events(2)], ["photo.jpg", "pic.webp"])

    def test_wrong_token_is_refused_and_writes_nothing(self):
        status, _ = self.post([("x.png", PNG)], path="/save/not-the-token-0000000000")
        self.assertEqual(status, 403)
        self.assertEqual(os.listdir(self.out), [])

    def test_non_images_and_unsafe_names_are_rejected(self):
        self.post([("notes.png", b"hello"), ("../evil.png", PNG), ("a/b.png", PNG)], back="https://chatgpt.com/")
        self.assertEqual([e.get("rejected") for e in self.events(3)],
                         ["not a PNG, JPEG or WebP image", "bad file name", "bad file name"])
        self.assertEqual(os.listdir(self.out), [])
        self.assertFalse(pathlib.Path(self.out).parent.joinpath("evil.png").exists())

    def test_redirects_only_to_allowed_chat_origins(self):
        status, loc = self.post([("ok.png", PNG)], back="https://evil.example/c/1")
        self.assertEqual((status, loc), (204, None))
        status, loc = self.post([("ok.png", PNG)], back="https://chatgpt.com.evil.example/")
        self.assertEqual((status, loc), (204, None))
        self.assertEqual([e["saved"] for e in self.events(2)], ["ok.png", "ok-2.png"])


if __name__ == "__main__":
    unittest.main()
