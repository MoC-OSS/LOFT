---
'@moc-global/loft': patch
---

Stop warning at startup about manifest entries that are not validated yet.

The manifest loads before the LLM strategies register, so every application logged a warning per LLM, "no schema registered yet - skipping validation", although each strategy validates its entries when it registers. The message is now logged at debug level and says that validation follows.
