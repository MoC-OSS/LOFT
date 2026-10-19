---
'@moc-global/loft-definitions': patch
---

The middleware chain now copies the payload before the first middleware as well, as the docs describe. A middleware that changed its input object used to change the caller's object too; code that relied on that by accident now sees the caller's payload unchanged.
