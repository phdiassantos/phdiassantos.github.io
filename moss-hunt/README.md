# 🌿 Campus Moss Hunt · BIOL 3160 (LSUA)

A phone app for the BIOL 3160 *Survey of the Plant Kingdom* ecology field survey. Students explore campus, find mosses, photograph them, identify them with an app (iNaturalist, Seek, PictureThis, Google Lens), and describe their morphology and ecology. Class results, graphs and a photo gallery update live as everyone submits.

**Open the app:** https://phdiassantos.github.io/moss-hunt/

Students can install it like an app:
- **iPhone (Safari):** Share button → *Add to Home Screen*
- **Android (Chrome):** menu ⋮ → *Install app* / *Add to Home screen*

No student accounts are needed. Students enter their name and LSUA email once.

---

## How it works

- **The app** (this repo) is hosted free on GitHub Pages.
- **The data** goes to a Google Sheet you own, through a small Google Apps Script:
  - **Observations** tab: one row per moss, with student name, email, ID, description, ecology and photo links
  - **Thumbs** tab: small preview images for the gallery (ignore it)
  - **Roster** tab (optional): paste student names in column A and emails in column B, and the Instructor view also lists who hasn't submitted
  - Full-size photos are saved in a Google Drive folder called **Moss Hunt Photos**

## One-time setup (about 5 minutes)

1. Create a new Google Sheet, for example *Moss Hunt Data*.
2. In the Sheet, go to **Extensions → Apps Script**. Delete the sample code, and paste everything from [`apps-script/Code.gs`](apps-script/Code.gs).
3. On the line `const ADMIN_KEY = 'change-this-secret';`, replace `change-this-secret` with your own secret word. This unlocks the Instructor view.
4. Click **Save**. Then choose the `setup` function in the toolbar and click **Run**. Approve the permissions; Google will warn that the app isn't verified, so click *Advanced → Go to …*. This creates the tabs and the Drive folder.
5. Click **Deploy → New deployment**. Choose the type **Web app** and set:
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**

   Click **Deploy**, then copy the **Web app URL** (it ends in `/exec`).
6. Put the URL in [`config.js`](config.js) as `scriptUrl: "https://script.google.com/macros/s/…/exec"`. You can edit the file right on GitHub with the pencil icon, then *Commit changes*.
7. Open the app and submit a test moss from your phone. Check that it shows up in the Sheet, then delete it from the app.

If you change the script later, go to **Deploy → Manage deployments**, click the pencil, set *Version: New version*, and click **Deploy**. The URL stays the same.

## Instructor view

Tap **Instructor** at the bottom of the app and enter your secret word. You'll see each student's name and email, number of finds, completion status (goal: `target` in `config.js`, default 3), the species they found, and their entries with photos. You can delete any entry and download a CSV. Everything is also in your Google Sheet.

## Privacy notes

- The public gallery shows students as *First L.* Full names and emails are only visible in your Sheet and in the Instructor view.
- Students can delete their own entries only from the phone they submitted them on.
- Students type their own name and email; there's no login. Compare with your roster.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app |
| `config.js` | Your settings: script URL and the per-student goal |
| `apps-script/Code.gs` | The Google Sheet backend (paste into Apps Script) |
| `manifest.webmanifest`, `sw.js`, `icons/` | Make it installable on phones |
