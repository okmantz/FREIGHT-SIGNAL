# Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Blank page, "Loading…" | Opened `index.html` from disk. Use Pages, `npm run serve`, or the single-file build. |
| "Storage could not be opened" | Private/guest window or IndexedDB blocked. Use a normal Chrome/Edge profile. |
| "ZIP Map: not loaded" | Bundled CSV failed to fetch. *System → Import a different ZIP Map CSV…* (headers: zip, lat, lng, city, state_id, population). |
| "Origin or destination could not be matched to ZIP Map" | City/state not in the ZIP Map (spelling, abbreviation). Edit the row's city/state or ZIP, then retry. The app never guesses. |
| "Could not find two distinct … alternatives" | Remote market. Widen *System → distance tiers*. |
| Matrix button missing | The group already has alternates. Delete the group (✕) and rebuild. |
| No outreach drafts | No Active carriers match the lane/state, all blocked by the blocklist, or the row lacks origin/destination state. The dialog says which. |
| `$1,650` not seen as a rate | Macro behaviour. Enable *Recognise comma-formatted carrier rates* in *System*. |
| .eml opens as a received message | Use classic Outlook or drag the file into the Drafts folder; or use *Open in mail app* / *Outlook on the web*. |
| Pop-up blocked on Rate/Wx | Allow pop-ups for the site. |
| Data disappeared | Site data was cleared or a different browser/profile/URL is in use. Restore from backup. |
| Old version after update | Hard-reload (Ctrl+Shift+R); the service worker updates on next load. |
