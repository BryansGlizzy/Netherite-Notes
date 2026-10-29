# Planned features

Ideas that are agreed but **not built yet**. Nothing here is available in the current release (1.2.x); it is a backlog, not documentation of behaviour.

## 1. Drag-and-drop import of `.md` files

**What:** users can drag one or more Markdown files from their computer onto the app and have them imported as notes in the current vault automatically.

**Behaviour to define when building**
- Drop target: the whole editor/sidebar area, with a visible "Drop to import" overlay while dragging. A file picker button as the accessible fallback (drag and drop is not usable on every device).
- Accepts `.md` and `.markdown` (and plain `.txt`); other file types are ignored with a clear message.
- Note title comes from the file name (without extension), or from a leading `# Heading` if one exists; duplicate titles get a numeric suffix because wiki-links match by title.
- Multiple files in one drop create multiple notes; show a summary ("5 imported, 1 skipped: too large").
- Frontmatter (`---` blocks) is kept as note content for now; no parsing.
- Respect existing limits: 1,000,000 characters per note, `MAX_NOTES_PER_VAULT`, and the vault must be writable (not offline read-only).
- Files are read in the browser and saved through the existing note routes (or one bulk request); no new server upload endpoint is needed unless folder import is added later.

**Open questions:** import whole folders (with sub-folders flattened or turned into prefixes)? Preserve file modified dates as `createdAt`/`updatedAt`? Import `[[wikilinks]]` as-is (yes, they are already the app's syntax) and what about `![[embeds]]` and standard `[links](x.md)`?

**Tests to add:** title derivation and de-duplication, size/quota rejection, mixed valid/invalid drops, vault-membership enforcement.

## 2. Export a single note as `.md`

**What:** an **Export** button in the note title bar, placed next to the AI assistant button and the other note actions (bookmark, split view, raw/preview toggle). It downloads the open note as a Markdown file.

**Behaviour to define when building**
- File name: the note title, sanitized for file systems (strip `/ \ : * ? " < > |`, trim, fall back to `Untitled`), with `.md` extension.
- Content: the note's markdown exactly as stored. The title is taken from the file name; optionally prepend `# Title` if the note does not start with it (decide, then keep consistent with import so a round trip is lossless).
- Generated in the browser (a `Blob` download), so it works offline and needs no new API route.
- Works in both live-preview and raw modes, and for the secondary pane in split view (export the focused note).
- Icon: `Download` (already in the icon set); tooltip "Export note as Markdown"; disabled when no note is open.
- Add the same action to the command palette ("Export current note as Markdown").

**Related, later:** "Export all notes as a `.zip` of `.md` files" next to the existing JSON vault backup.

**Tests to add:** file-name sanitization (unit), the button's presence and disabled state, round-trip import ↔ export equality.

## Suggested order

1. Single-note export (small, self-contained, no server work).
2. Drag-and-drop import using the same title rules, so export → import round-trips cleanly.
3. Optional follow-ups: folder import, `.zip` export.
