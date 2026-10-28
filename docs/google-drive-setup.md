# Connect the Lesson Planner to Google Drive

About 10 minutes, once. You make a free "Google project" that lets the planner open
Google's sign-in window. Nothing here costs money, and no IT approval is needed to try.

The planner asks to **change only files you pick or files it made**, and to **look at** (never change) your Drive files —
that's how it can bring in whole folders of slide decks and notice new decks you add to them.

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
(Lesson Decks → + Add → From Google Drive). Google shows the new permission once.

## 6. Make the Client ID (code #1)

1. In the left menu click **Clients**, then **Create client**.
2. **Application type:** Web application. **Name:** `Lesson Planner`.
3. Under **Authorized JavaScript origins**, click **Add URI** and paste exactly:

   ```
   http://localhost:5178
   ```

   (The planner's Setup tab has a **Copy** button for this.) Leave "redirect URIs" empty.
4. Click **Create**.
5. Copy the **Client ID** — it ends in `.apps.googleusercontent.com`.
6. Copy the **Client secret** too (starts with `GOCSPX-`). If you closed the window: **Clients** → **Lesson Planner**,
   it's on the right. This one *is* private: paste it only into the planner, never send it to anyone.

## 7. Make the API key (code #2)

1. Open the menu ☰ → **APIs & Services** → **Credentials**.
2. Click **+ Create credentials** → **API key**. Copy the key (starts with `AIza`).
3. Click **Edit API key** (or the key's name) to lock it down:
   - **Application restrictions:** Websites → **Add** → `http://localhost:5178/*`
   - **API restrictions:** Restrict key → tick **Google Picker API**.
   - Click **Save**.

## 8. Connect the planner

1. Open the planner (double-click **Start Lesson Planner**). It opens at `http://localhost:5178`.
2. Go to the **Setup** tab → **Google Drive** card.
3. Paste the **Client ID**, **Client secret** and **API key** into their boxes (click outside each box to save it).
   The client secret is kept in a separate file on this computer (`data/google-auth.json`), never in your lesson data.
4. Click **Connect Google Drive**. Google's window opens:
   sign in with your **school account** and click **Continue** / **Allow**.
5. You should see **✓ Connected to Google Drive as …**.

You stay signed in: each time the planner opens it reconnects by itself.

**About once a week**, while the Google project is in *testing* mode, Google ends the sign-in. A note pops up in the
bottom-left corner — **"Google Drive signed you out"** — click **Sign in**, pick your account, click **Allow**. Same codes, nothing to redo.
(The **Sign in again** button on the Setup tab does the same.)

---

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **"Access blocked: … has not been approved by your admin"** or **"…is blocked by your organization"** | Your school only allows apps IT has approved. | This is the one thing only IT can change. Ask IT to allow the app (give them the Client ID), or we stop here. |
| **"Error 400: origin_mismatch"** | The address in step 6 doesn't match. | Check step 6 says exactly `http://localhost:5178` (no slash at the end). Changes can take 5 minutes to work. |
| **"Access blocked: … has not completed the Google verification process"** / **"access_denied"** | Using a personal-Gmail project and your school email isn't a test user. | Do step 4 #7 (add your school email as a test user). |
| **"Google Drive API isn't turned on"** (in the planner) | Step 3 was skipped. | Enable **Google Drive API**, wait a minute, connect again. |
| **"Google didn't accept the Client ID or client secret"** | One of them was copied incompletely. | Copy both again from **Clients** → **Lesson Planner**. |
| **The Google window doesn't open** | Pop-ups are blocked. | Allow pop-ups for `localhost:5178` (icon at the right of the address bar). |
| **"Google only works when the planner is opened at http://localhost:5178"** | The planner was opened at a different address. | Click the link shown, or close it and double-click **Start Lesson Planner**. |
