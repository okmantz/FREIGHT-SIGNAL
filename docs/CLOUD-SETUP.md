# Cloud accounts: one-time setup (about 5 minutes, free)

**This is optional.** Without it, everyone already has an account on their own computer (e-mail + password, private data per account, nothing uploaded). Add the cloud when you want people to sign in from any computer and find their data there.

With this switched on, anyone you send the link to can **create their own account** (e-mail + password) and gets a private workspace: loads, carriers, customers, inquiries, drafts, cover log and settings are saved to their account and follow them to any computer. Without it, Freight Signal keeps working exactly as before (data only in that browser).

It uses a free Google **Firebase** project (Spark plan, no credit card): *Authentication* for the accounts, *Realtime Database* for the saved data. No server to run.

## Steps

1. Go to <https://console.firebase.google.com> > **Add project**. Name it (for example `freight-signal`). Turn Google Analytics **off**.
2. **Build > Authentication > Get started > Sign-in method > Email/Password > Enable > Save.** (Leave "Email link" off.)
3. **Build > Realtime Database > Create Database.** Pick the location nearest you. Choose **Locked mode**.
4. In Realtime Database open the **Rules** tab, replace everything with the contents of [`database.rules.json`](../database.rules.json) from this repo, and press **Publish**. This rule is what keeps accounts private: a signed-in person can read and write only `users/<their own id>`.
5. Click the gear > **Project settings > General > Your apps > Web (`</>`)**. Register an app (skip Firebase Hosting). From the snippet copy two values:
   * `apiKey`
   * `databaseURL` (also shown at the top of the Realtime Database page, e.g. `https://freight-signal-default-rtdb.firebaseio.com`; regions outside the US look like `https://freight-signal-default-rtdb.europe-west1.firebasedatabase.app`)
6. On GitHub open **`js/config.js`**, press the pencil, paste the two values between the quotes, and commit. Wait a minute for GitHub Pages to update.
7. Open the site and choose **Create account**. Then **Account Settings > Account & sync > Invite people** shows the link to share.

You will see the header pill **Saved to account** once everything works. If it says **Sync problem**, hover it: the message names the fix (usually step 2 or step 4).

## Good to know

* **Existing data.** The first account created on a browser that already holds Freight Signal data is offered that data ("Add your existing data to this account?"). Say yes on your own computer.
* **Sharing.** Everyone has their own private workspace; people do not see each other's loads. A shared team workspace is not part of this version.
* **Offline.** The app keeps a copy on each device and works without internet. Changes upload automatically when you are back online.
* **Two computers at once.** Each list (loads, carriers, ...) is saved as a whole; if you edit the same list on two computers in the same moment, the most recent save wins and a notice appears. The app re-checks the cloud when you return to the tab and every minute.
* **Lock the door after your team has joined:** Authentication > Settings > User actions > untick *Enable create (sign-up)*. Existing people can still sign in. Tick it again to invite someone new.
* **Seeing and removing people:** Authentication > Users. Delete a user there, then delete `users/<their id>` in Realtime Database to remove their data. People can also delete their own account under Account Settings.
* **Password resets** are sent by Firebase from `noreply@<project>.firebaseapp.com`. Edit the wording under Authentication > Templates.
* **The API key is not a secret** (every Firebase web app publishes it). Do not add an "HTTP referrer" restriction to it: the app sends no referrer on purpose, so the key would stop working. The database rule in step 4 is what protects the data.
* **Privacy, plainly.** Data is stored in your Firebase project (Google Cloud), protected by sign-in and the rule above. It is not end-to-end encrypted: as the project owner you can open the Realtime Database page and see everyone's data, and Google operates the storage. Tell the people you invite, and check that your employer's data policy allows load, customer and carrier data in a cloud service before inviting colleagues or entering real company data.
* **Cost.** Spark plan limits are 1 GB stored and 10 GB/month downloaded, far more than this app needs for a team.

## Turning it off again

Empty the two values in `js/config.js`. The app returns to browser-only storage; each person's cloud data stays in the database until you delete it.
