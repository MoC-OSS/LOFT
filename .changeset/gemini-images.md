---
'@moc-global/loft-gemini-strategy': patch
---

Images in a message now reach Gemini. The request adapter sent text parts only and dropped images without a warning. A base64 image now goes as `inlineData` and an image URL as `fileData`, which Gemini fetches (a `gs://` URI or a public URL). When the part has no MIME type, it comes from the data (PNG, JPEG, GIF, WebP) or the URL extension, and JPEG otherwise.
