# Connect the Lesson Planner to Google Drive

About 10 minutes, once. You make a free "Google project" that lets the planner open
Google's sign-in window. Nothing here costs money, and no IT approval is needed to try.

The planner asks to **change only files you pick or files it made**, and to **look at** (never change) your Drive files —
that's how it can bring in whole folders of slide decks, notice new decks you add to them, and find plans shared with you.
Your plans are saved as files in a **Lesson Planner** folder in your Drive (one per school year).

Google changes its screens now and then; if a button name is slightly different, look for the closest match.

---

## 1. Open Google's developer site

1. Go to **https://console.cloud.google.com**
2. Sign in with your **school Google account**.
   - If it says your account can't use this site, sign out and use a **personal Gmail** account instead.
     That's fine — you'll still sign in to Drive with your school account later.
3. If asked, pick your country and agree to the terms.

## 2. Make a project

1. At the top left, click the **project picker** (it may say "Select a project").
2. Click **New project**.
3. Project name: `Lesson Planner`. Leave the rest as is. Click **Create**.
4. When it's done, make sure **Lesson Planner** is shown in the project picker at the top.

## 3. Turn on the Google services the planner uses

1. In the search bar at the top, type **Google Drive API**, open it, click **Enable**.
2. Search **Google Picker API**, open it, click **Enable**.
3. Search **Google Slides API**, open it, click **Enable**.

(Picker and Slides are for the next steps — choosing decks and filling in slides. Turning them on now saves a trip.)

## 4. Describe the app for the sign-in window

1. Search **Google Auth Platform** (or open the menu ☰ → **APIs & Services** → **OAuth consent screen**).
2. Click **Get started**.
3. **App name:** `Lesson Planner`. **User support email:** pick your email. Click **Next**.
4. **Audience:**
   - If you're signed in with your **school account**, choose **Internal** (only people at your school can use it — best).
   - If you're using a **personal Gmail**, choose **External**.
   Click **Next**.
5. **Contact information:** your email. Click **Next**.
6. Tick **I agree…**, click **Continue**, then **Create**.

**Only if you chose External:**

7. In the left menu click **Audience**. Under **Test users**, click **Add users**,
   type your **school email address**, and click **Save**. Leave the status as **Testing**.

## 5. Say what the planner is allowed to do

1. In the left menu click **Data Access**.
2. Click **Add or remove scopes**.
3. In the filter box type `drive.file`, tick the row ending in **/auth/drive.file**
   ("See, edit, create, and delete only the specific Google Drive files you use with this app").
4. Clear the filter, type `drive.readonly`, and tick the row ending in **/auth/drive.readonly**
   ("See and download all your Google Drive files"). This lets the planner read inside folders you bring in.
   Keep **both** rows ticked: `drive.readonly` only adds reading. Saving still comes from `drive.file`, which lets the planner
   create files (like filled-in copies of your decks) and change the files it made or that you picked.
5. Click **Update**, then **Save** at the bottom.

**Already connected before folders were added?** Do step 5 above, then in the planner click **Sign in again** when it asks
(Lesson Templates → + Add → From Google Drive). Google shows the new permission once.

## 6. Make the Client ID (code #1)

1. In the left menu click **Clients**, then **Create client**.
2. **Application type:** Web application. **Name:** `Lesson Planner`.
3. Under **Authorized JavaScript origins**, click **Add URI** for each address the planner is opened at:

   ```
   http://localhost:5178
   ```

   and the website address (see `docs/hosting.md`), for example:

   ```
   https://your-github-name.github.io
   ```

   Just the start of the address — no slash or folder at the end.  Leave "redirect URIs" empty.
4. Click **Create**.
5. Copy the **Client ID** — it ends in `.apps.googleusercontent.com`.
   (The planner no longer needs the client secret.)

## 7. Make the API key (code #2)

1. Open the menu ☰ → **APIs & Services** → **Credentials**.
2. Click **+ Create credentials** → **API key**. Copy the key (starts with `AIza`).
3. Click **Edit API key** (or the key's name) to lock it down:
   - **Application restrictions:** Websites → **Add** → `http://localhost:5178/*`, and **Add** again →
     the website address with `/*` at the end (e.g. `https://your-github-name.github.io/*`)
   - **API restrictions:** Restrict key → tick **Google Picker API**.
   - Click **Save**.

## 8. Give the codes to the website

The codes are built into the planner website when it's published, so nobody using it ever types them in.
Put them in the GitHub repository's secrets (see `docs/hosting.md`, step 3):

- `GOOGLE_CLIENT_ID` — the Client ID from step 6
- `GOOGLE_API_KEY` — the API key from step 7

(For the copy on your own computer, `Start Lesson Planner` builds them in from the older planner's saved settings.)
If either is missing or looks wrong, the planner shows a red **"Google Drive isn't set up for this website"** error.

## 9. Connect

1. Open the planner and click **Connect Google Drive**. Google's window opens:
   sign in with your **school account** and click **Continue** / **Allow**.
2. The top bar shows **Drive connected**.

**Staying connected:** Google gives the planner a pass that lasts an hour. When you open the planner, and about once
an hour after that, your next click anywhere reconnects it (Google's window may flash for a moment).
Your changes are kept on the computer meanwhile and go to Drive as soon as it reconnects.

---

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **"Access blocked: … has not been approved by your admin"** or **"…is blocked by your organization"** | Your school only allows apps IT has approved. | This is the one thing only IT can change. Ask IT to allow the app (give them the Client ID), or we stop here. |
| **"Error 400: origin_mismatch"** | The address the planner is open at isn't in step 6. | Add it exactly as the Google Drive card shows it (no slash at the end). Changes can take 5 minutes to work. |
| **"Access blocked: … has not completed the Google verification process"** / **"access_denied"** | Using a personal-Gmail project and your school email isn't a test user. | Do step 4 #7 (add your school email as a test user). |
| **"Google Drive API isn't turned on"** (in the planner) | Step 3 was skipped. | Enable **Google Drive API**, wait a minute, connect again. |
| **"Google didn't accept the Client ID"** | It was copied incompletely. | Copy it again from **Clients** → **Lesson Planner** into the `GOOGLE_CLIENT_ID` secret, then publish again. |
| **Red "Google Drive isn't set up for this website"** | A secret is missing or mistyped. | The error says which one; fix it in GitHub (`docs/hosting.md` step 3) and publish again. |
| **The Google window doesn't open** | Pop-ups are blocked. | Allow pop-ups for the planner's address (icon at the right of the address bar). |
| **Picking files says the API key isn't allowed** | The website address isn't in step 7's list. | Add it (with `/*` at the end) under the API key's **Websites**. |
| **A colleague can't sign in** | Your Google project is in testing mode. | Add their email as a test user (step 4 #7). |
