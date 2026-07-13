# Google Drive folder sync

Link a Mnema folder to a Google Drive folder and keep their files in sync **both
ways**: add a file in Mnema and it appears in Drive; add one in Drive and it
appears in Mnema — for the file types you allow. This is a **bring-your-own OAuth
app** integration: the operator supplies a Google Cloud OAuth client (like the
Voyage/Gemini API keys), then each user connects their own Google account.

- **What syncs.** Files in a linked folder. Text files (`.md`, `.txt`) become
  Mnema **docs** you can edit; other allowed types (`.pdf`, `.docx`, images, …)
  become **attachments**. You choose the allowed types per link.
- **What doesn't (yet).** Live collaborative editing of a doc's body into a Google
  Doc and back. Mnema exports a doc as a `.md` file to Drive; it doesn't drive
  Google Docs' own editor. Google Shared Drives are not supported in v1.

---

## For users

Once your operator has configured Drive (below), open **Settings → Integrations**:

1. **Connect Google Drive** — you're sent to Google's consent screen; approve and
   you're returned to Settings.
2. **Link a folder** — pick a Mnema folder, then either choose an existing Drive
   folder or have Mnema **create one** in your Drive from the Mnema folder.
3. **Choose a direction** — two-way (default), Drive → Mnema only, or Mnema → Drive
   only — and tick the **file types** to sync.
4. Mnema queues an initial sync. Use **Sync now** any time; **Pause** to stop a
   link temporarily; **Unlink** to disconnect (your Mnema docs stay; the Drive
   folder is untouched).

**Conflicts.** If a file changed on *both* sides since the last sync, the default
`manual` policy flags it as a conflict and does **not** overwrite either side —
resolve it from the link. (A per-link last-writer-wins option is available.)

---

## For self-hosters — one-time setup

Drive stays disabled until you create a Google Cloud OAuth client and set three
env vars. It's bring-your-own so nothing is baked into the image.

1. In **Google Cloud Console** → *APIs & Services*:
   - **Enable the Google Drive API.**
   - **OAuth consent screen** → External (or Internal for a Workspace org); add
     your email as a test user while unverified.
   - **Credentials → Create Credentials → OAuth client ID → Web application.**
   - Add an **Authorised redirect URI** that exactly matches your callback:
     `http://localhost:8080/api/drive/callback` (self-host default) or
     `https://<your-host>/api/drive/callback` behind TLS.
2. Put the client id/secret + redirect URI in `.env`:

   ```bash
   GOOGLE_DRIVE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_DRIVE_CLIENT_SECRET=xxxxxxxx
   GOOGLE_DRIVE_REDIRECT_URI=http://localhost:8080/api/drive/callback
   GOOGLE_DRIVE_SCOPE=drive.file          # or 'drive' — see the scope note below
   ```
3. `docker compose up -d --build` (the migration `0073_drive_sync.sql` applies
   automatically). Binary files (`.pdf`, `.docx`, images) also need R2 configured
   (`R2_*`); text files sync without it.

### The scope choice

| `GOOGLE_DRIVE_SCOPE` | What users can link | Google review |
| :------------------- | :------------------ | :------------ |
| `drive.file` (default) | Folders Mnema **creates**, plus files the user explicitly opens with Mnema. Least privilege. | None |
| `drive` | **Any existing** Drive folder — needed to pull pre-existing content wholesale. | Requires Google's [restricted-scope security review](https://support.google.com/cloud/answer/9110914) before real users can use it in production. |

Start with `drive.file`. Switch to `drive` only if users need to import folders
they didn't create through Mnema, and budget for Google's review.

### Env-var reference

| Var | Default | Purpose |
| :-- | :------ | :------ |
| `GOOGLE_DRIVE_CLIENT_ID` | — | OAuth client id (required to enable) |
| `GOOGLE_DRIVE_CLIENT_SECRET` | — | OAuth client secret |
| `GOOGLE_DRIVE_REDIRECT_URI` | — | Must equal your `/api/drive/callback` URL |
| `GOOGLE_DRIVE_SCOPE` | `drive.file` | `drive.file` (least priv) or `drive` (full) |
| `DRIVE_SYNC_MAX_FILE_MB` | `50` | Skip Drive files larger than this |
| `DRIVE_WEBHOOK_SECRET` | falls back to `SECRETBOX_MASTER_KEY` | Signs Drive push-channel tokens |

The refresh token is encrypted at rest with `SECRETBOX_MASTER_KEY` (AES-256-GCM,
the same secret-box used for calendar) — no extra secret needed.

---

## How it works (under the hood)

- **Connect** (`GET /api/drive/connect` → Google → `GET /api/drive/callback`)
  stores an encrypted offline refresh token on your workspace membership.
- **Links** live in `drive_folder_links`; every synced file is tracked in
  `drive_file_mappings` (Drive file id ⇄ Mnema doc/attachment + checksums), so sync
  is **idempotent** — re-running never duplicates.
- **Pull** (Drive → Mnema) lists the linked folder, and for each accepted, changed
  file (by `md5Checksum`) writes/updates a doc or attachment.
- **Push** (Mnema → Drive) exports the linked folder's docs to `.md` files.
- A **BullMQ worker** (`drive-sync`) runs syncs triggered by *Sync now*, and by
  Google **push notifications** (`POST /api/drive/webhook`) for near-real-time
  pulls.

## Troubleshooting

- **"Google Drive isn't configured."** The three `GOOGLE_DRIVE_*` vars aren't all
  set — check `.env` and rebuild.
- **Redirect URI mismatch (Google 400).** The URI in Google Cloud must match
  `GOOGLE_DRIVE_REDIRECT_URI` character-for-character, including scheme and port.
- **Binary files skipped.** R2 isn't configured — set `R2_*`. Text files still sync.
- **Can't see an existing folder in the picker.** With `drive.file` scope Mnema
  only sees folders it created; switch to `drive` scope to link pre-existing folders.
