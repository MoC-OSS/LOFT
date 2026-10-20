---
'@moc-global/loft-gemini-strategy': patch
---

Images in a message now reach Gemini. The request adapter sent text parts only and dropped images without a warning. A base64 image (or a base64 `data:` URL) now goes as `inlineData`, and an `https://` or `gs://` URL as `fileData`, which Gemini fetches. Other URLs are left out with a warning, as Gemini would reject every later request of the session. When the part has no MIME type, it comes from the data (PNG, JPEG, GIF, WebP, HEIC, AVIF, BMP) or the URL extension, and JPEG otherwise, with a warning.
