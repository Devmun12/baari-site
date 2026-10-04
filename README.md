# Baari landing page and "Set up the week" demo

A one-page site for Baari with one working AI feature. A visitor fills in a parent's week and gets a 7-day care plan split fairly between two family members.

How it fits together:

```
Visitor's browser (index.html)
   |  sends the form answers (no keys in the page)
   v
Vercel function  /api/setup-week   -- holds the secret keys
   |-- checks every answer, enforces 3 plans per visitor
   |-- asks Google Gemini for the plan, then checks the answer
   |-- saves the request and plan in Supabase (never the note text)
   v
Supabase table  week_plans  -->  /api/stats  -->  "N families have set up their week"
```

## What is in this folder

| File or folder | What it is |
| --- | --- |
| `index.html` | The whole landing page, including the demo form and weekly board |
| `api/setup-week.js` | Makes a plan (Gemini) and stores it (Supabase) |
| `api/stats.js` | Reads the numbers shown above the demo |
| `api/_lib/baari.js` | Shared code: allowed values, the Gemini instructions, safety checks |
| `supabase/schema.sql` | Creates the database table and two read-only views. You run it once |
| `package.json` | Tells Vercel this is modern JavaScript on Node 18 or newer |
| `.env.example` | The names of the secret settings (no values) |
| `dev/` | Local test server and automated tests. Not deployed |

## Before you start

You need four free accounts. Sign up with the same email if you can.

1. **GitHub** (github.com), to hold the files
2. **Supabase** (supabase.com), the database
3. **Google AI Studio** (aistudio.google.com), for the Gemini key
4. **Vercel** (vercel.com), to put the site online. Sign up with "Continue with GitHub"

Keep a private note open (not a shared doc) to paste three things into as you go: the Supabase URL, the Supabase secret key and the Gemini key.

## Step 1. Create the database in Supabase

1. Go to supabase.com and sign in. Click **New project**.
2. Give it a name such as `baari`. Pick the region closest to your users (for India, **Mumbai**). Choose a strong database password and save it somewhere safe. Click **Create new project** and wait a minute or two.
3. In the left menu, open **SQL Editor** and click **New query**.
4. Open the file `supabase/schema.sql` from this folder, copy everything in it, and paste it into the editor.
5. Click **Run**. You should see "Success. No rows returned".
6. Open **Table Editor** in the left menu. You should now see a table called `week_plans`. It is empty, which is correct. The script also creates two views, `family_stats` and `task_popularity`, which feed the numbers above the demo.

## Step 2. Copy your Supabase URL and secret key

Supabase moves its menus around from time to time. If a name below doesn't match, use the search box in the dashboard.

1. Open **Project Settings** (the gear icon), then the **API Keys** page.
2. Under **Secret keys**, create or reveal a secret key. It starts with `sb_secret_`. Copy it into your private note as the **Supabase secret key**.
   - The legacy **service_role** key (starts with `eyJ`) also works, but Supabase is retiring legacy keys by the end of 2026, so prefer the new secret key.
   - Never copy the "publishable" or "anon" key for this. It won't work, by design.
3. Find your **Project URL**. It looks like `https://abcdefgh.supabase.co`. It is on the project's home page and in the API or Data API settings. Copy it as the **Supabase URL**.

The secret key can read and change your whole database. Never paste it into `index.html`, a chat or a public place.

## Step 3. Get a Gemini API key

1. Go to aistudio.google.com and sign in with a Google account.
2. Click **Get API key**, then **Create API key**. Follow the prompts.
3. Copy the key into your private note as the **Gemini key**. Keep it private too.

## Step 4. Put the files on GitHub

1. On github.com, click **New** (or the **+** at the top right, then **New repository**).
2. Name it `baari-site`. Choose **Public**, because graders must be able to see the code. No secret is in these files, so this is safe. Click **Create repository**.
3. On the next page, click **uploading an existing file**.
4. Drag in **everything** from this folder: `index.html`, `package.json`, `README.md`, `.gitignore`, `.vercelignore`, `.env.example`, and the folders `api`, `supabase` and `dev`.
   - Files starting with a dot are hidden on most computers. On a Mac, press **Cmd + Shift + .** in Finder to show them. On Windows, tick **Hidden items** under the View menu in File Explorer.
   - If you ever made a file called `.env` with real keys in it, do **not** upload it.
5. Click **Commit changes**.

Check that the `api` folder on GitHub contains `setup-week.js`, `stats.js` and a `_lib` folder. If a folder didn't upload, drag that folder in again.

## Step 5. Import the project into Vercel

1. On vercel.com, click **Add New**, then **Project**.
2. Find `baari-site` in the list of GitHub repositories and click **Import**. If it isn't listed, click the option to adjust GitHub app permissions and give Vercel access to that repository.
3. On the setup screen:
   - **Framework Preset**: choose **Other**.
   - Leave **Root Directory** as it is, and leave the build and output settings empty.
4. Open **Environment Variables** and add these three, one at a time (name on the left, value on the right):

   | Name | Value |
   | --- | --- |
   | `GEMINI_API_KEY` | your Gemini key |
   | `SUPABASE_URL` | your Supabase URL, like `https://abcdefgh.supabase.co` |
   | `SUPABASE_SERVICE_KEY` | your Supabase secret key (`sb_secret_...` or `eyJ...`) |

   Optional extras:

   | Name | Value |
   | --- | --- |
   | `GEMINI_MODEL` | Leave empty to use `gemini-3.5-flash-lite`. If that model ever fails, set this to `gemini-3.1-flash-lite`. Check Google's Gemini API deprecations page before changing it |
   | `IP_HASH_SALT` | Any long random text. It scrambles visitors' IP addresses before they are stored |

   Don't set `GEMINI_MODEL` to a 2.5 model (such as `gemini-2.5-flash-lite`). Google now serves 2.5 models only to people who used them before, so a brand-new key may be refused and every plan would fail.

5. Click **Deploy** and wait for it to finish. Vercel gives you a link such as `baari-site.vercel.app`.
6. Share the **production domain** shown under **Domains** on the project page (for example `baari-site.vercel.app`). Long deployment-specific links can ask visitors to log in to Vercel. Open your link in a private or incognito window to check that a stranger can see it.

## Step 6. Redeploy after changing settings

Vercel only picks up new or changed environment variables on a **new** deployment. If you add or fix a variable after the first deploy:

1. Open your project in Vercel and go to the **Deployments** tab.
2. Click the three dots next to the newest deployment and choose **Redeploy**.

Every time you upload changed files to GitHub, Vercel redeploys on its own.

## Step 7. Test it

Open your Vercel link and scroll to "Set up Ma and Papa's week in 60 seconds".

1. **The database is connected.** Above the form you should see "Be the first family to set up their week with Baari". If nothing appears there, see Troubleshooting.
2. **A plan works.** Click **Set up the week**. After a few seconds a weekly board appears with a Daily row, Mon to Sun, a Share of care bar and a tip. The line above the form changes to "1 family has set up their week with Baari".
3. **It was saved.** In Supabase, open **Table Editor**, then `week_plans`. There is one row. The `input` column shows the answers and `note_present`, never the note itself.
   "Families" counts people, not plans: more plans from the same browser still count as one family. A different person on another device adds one.
4. **Copy works.** Click **Copy for WhatsApp** and paste into a chat to yourself.
5. **The doctor rule works.** Type a note like "Ma has had chest pain since morning" and set up the week again. A message says Baari added an "Ask the doctor" task, and the tip says to call 112. A note asking which medicines to give also adds the "Ask the doctor" task.
6. **The limit works.** Make one more plan (that is 3). The 4th try shows "You've tried the demo 3 times. Join the pilot to set up your real week."

To try again yourself after hitting the limit, delete your own rows in the Supabase Table Editor.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| "The demo isn't switched on yet" | One of the three environment variables is missing in Vercel. Add it, then **Redeploy** (Step 6) |
| No "families" line above the form | `SUPABASE_URL` or `SUPABASE_SERVICE_KEY` is wrong, or `schema.sql` wasn't run. Check both, then redeploy |
| "We couldn't reach Baari's database" | Same as above. Also check the Supabase project isn't paused (free projects pause after a period without use) |
| "Baari's planner couldn't make a plan just now" | The Gemini key is wrong, or the key has hit its limit. Create a new key in AI Studio, update `GEMINI_API_KEY`, redeploy. If you set `GEMINI_MODEL` to a 2.5 model, a new key may be refused: remove it (or set `gemini-3.1-flash-lite`) and redeploy |
| "Baari's planner is busy right now" | Gemini's rate limit was hit. Wait a minute and try again |
| Anything else | In Vercel, open your project and then **Logs**. The functions write a short reason there. Keys are never written to the logs |

## Safety and privacy, in short

- The keys live only in Vercel's environment variables. The page never sees them.
- The form only offers fixed choices. It never asks for names, ages or health details. The server rejects anything outside the allowed values.
- The optional note is cut to 120 characters, sent to Gemini to help with timing, and never stored.
- Gemini is told never to give medical, medicine, dosage, diet or symptom advice. If its answer still mentions doses or medicine names (such as "500 mg" or "2 tablets"), the server swaps it for a safe standard plan and marks the row `refused`.
- If a note mentions symptoms, an emergency or medicines (including "dawai" or "goli"), the plan always gets an "Ask the doctor about the concern in the note" task. Urgent notes get a tip to call 112 or the parent's doctor. The server enforces this even if the model forgets.
- The word "tablet" on its own is allowed, because it is also a device ("video call on the tablet").
- Each visitor can make 3 plans. The limit uses a random id kept in the browser and a scrambled (hashed) IP address, never the raw IP.

## For technical teammates: run and test locally

You need Node 18 or newer. There are no packages to install for the site itself.

```bash
node dev/server.mjs          # http://localhost:3000, with fake Gemini and Supabase (no internet needed)
DEV_REAL=1 node dev/server.mjs   # same, but uses real services with keys from a local .env file
```

Automated checks (needs Playwright once: `npm i --no-save playwright && npx playwright install chromium`):

```bash
node dev/e2e.mjs
```

The checks cover a plan on desktop and at 375px, the stats number going up (once per visitor), the 4th-request limit, the doctor flag, the "500 mg" safe fallback, the medicine-word rules, the Gemini settings for each model family (and the retry without thinking settings), server validation, the 30-second stats cache, both kinds of Supabase key, and a scan for Google key strings. Screenshots go to `dev/out/`. The `dev` folder is listed in `.vercelignore`, so it is never deployed.
