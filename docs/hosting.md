# Put the planner on the web (so it opens at school)

About 15 minutes, once. The planner becomes a free website on **GitHub Pages**. The website only holds the
planner's program — your plans stay in your Google Drive (and a copy in each computer's browser). Afterwards, every
change to the planner's `main` branch publishes itself.

## 1. Make a GitHub account

1. Go to **https://github.com/signup** and make a free account (a personal email is fine).
2. Your account name becomes part of the address: `https://<your-name>.github.io/lesson-planner/`.

## 2. Make an empty repository

1. Go to **https://github.com/new**.
2. **Repository name:** `lesson-planner`. **Public** (free Pages needs public; only the program is in it — no plans,
   no names, no Google codes). Don't tick any "add a README" boxes. Click **Create repository**.

## 3. Add the Google codes as secrets

1. In the new repository: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Name `GOOGLE_CLIENT_ID`, value: the Client ID (`docs/google-drive-setup.md` step 6). **Add secret**.
3. Again: name `GOOGLE_API_KEY`, value: the API key (step 7). **Add secret**.

## 4. Switch on Pages

**Settings** → **Pages** → under **Build and deployment**, **Source:** choose **GitHub Actions**.

## 5. Send the planner to GitHub

Tell Claude the repository address; it pushes the code (a GitHub sign-in window may open once).
Then open the repository's **Actions** tab: "Publish the planner" runs the tests and publishes (a green ✓ in ~2 minutes).

## 6. Tell Google about the new address

In Google Cloud (`docs/google-drive-setup.md`):
- **Clients → Lesson Planner → Authorized JavaScript origins → Add URI:** `https://<your-name>.github.io`
- **Credentials → your API key → Websites → Add:** `https://<your-name>.github.io/*`

## 7. Try it at school

Open `https://<your-name>.github.io/lesson-planner/` on the school computer, click **Connect Google Drive**, and
open your plan. Bookmark it.

| If… | Then… |
|---|---|
| The page won't open at school | The school blocks `github.io`. Tell Claude — another free host can be used. |
| "Access blocked … by your admin" when connecting | The school blocks the Google app; only IT can allow it. |
| A red "Google Drive isn't set up for this website" | A secret from step 3 is missing or mistyped. Fix it, then re-run the publish (Actions → Publish the planner → **Run workflow**). |
