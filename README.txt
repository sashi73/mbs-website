Modern Building Solutions - website + Mr. Fixit (runs on your computer)
=======================================================================

YOUR KEYS LIVE IN ONE FILE: .env
- It is in this folder. Open it with Notepad (Windows) or TextEdit (Mac).
- Fill in the values after the = signs. No quotes, no spaces.
- The website never sees these keys. Only the local server reads them.
- Never email .env or upload it anywhere. (On a Mac, files starting with a dot are
  hidden: press Cmd+Shift+. in Finder to show them.)

STEP 1 - Install Node.js (once)
  Download the LTS version from https://nodejs.org and install it.

STEP 2 - Get your keys
  a. DeepSeek: platform.deepseek.com > API keys > create. Paste into LLM_API_KEY.
     (Add a small balance to the account, or the AI will refuse.)
  b. Telegram: in Telegram search @BotFather > /newbot > follow the steps.
     Paste the token into TELEGRAM_BOT_TOKEN.
     Then search your new bot, press Start and send it "hi".
     Leave TELEGRAM_CHAT_ID empty for now: the setup check finds it for you.
     Telegram and email are BOTH required: enquiries only send when both work.
     (Staff group instead? Add the bot to the group and send a message there.)
  c. Resend: resend.com > sign up > API Keys > create. Paste into RESEND_API_KEY.
     Put the email you signed up with into OWNER_EMAIL.
     (Once you verify your own domain in Resend, you can send to any address and
      change FROM_EMAIL to e.g. MBS Website <website@modernbuildingsolutions.com.au>.)
  Save .env.

STEP 3 - Run the setup check
  Windows: double-click  check-setup-windows.bat
  Mac:     double-click  check-setup-mac.command   (first time: right-click > Open)
  Or in a terminal in this folder:  npm run check
  To ask Mr. Fixit a test question from the terminal:
    node --env-file=.env tools/check-setup.mjs "Why is my paint peeling?"
  It tests the AI key, sends a test Telegram message and a test email,
  and prints your TELEGRAM_CHAT_ID if it is missing. Copy it into .env and run again
  until all three show a tick.

STEP 4 - Start the website
  Windows: double-click  start-windows.bat
  Mac:     double-click  start-mac.command
  Or:      npm start
  Your browser opens http://localhost:8888. Keep the window open while you use it.
  A copy of start-windows.bat on your Desktop also works: it finds this folder by
  itself (after one start from here) and uses the .env in this folder. It also stops
  any MBS server that is already running, so you always see this folder's pages.
  Press Ctrl+C in that window to stop.

CHANGING THE PORT
  In .env set PORT=8890 (any free number) and ALLOWED_ORIGIN=http://localhost:8890

WHAT'S IN THIS FOLDER
  index.html ... contact.html   the five pages
  assets/fixit-kb.js            Mr. Fixit's knowledge: services, phone, licence. Edit freely.
  assets/fixit.js               Mr. Fixit's brain and animations
  netlify/functions/            the private server code (chat + sending enquiries)
  local-server.mjs              the local web server (reads .env)
  tools/check-setup.mjs         the setup check
  .env / .env.example           your keys / a blank copy for reference

HOW MR. FIXIT WORKS
  - Most questions are answered instantly from assets/fixit-kb.js (no AI cost).
  - Unusual questions go to DeepSeek through the local server.
  - Every enquiry is sent by BOTH email and Telegram. Both must be set up in .env
    (change with REQUIRED_CHANNELS if ever needed).
  - "Yes, call me" collects the job, suburb, urgency, name, phone, optional email and
    the best time to call, shows a summary to confirm, then sends it to staff by
    Telegram and email straight away.
  - He never gives prices or safety sign-offs, and sends emergencies to 0420 494 990 / 000.

REFERENCE NUMBERS AND THE ENQUIRIES DATABASE
  Every enquiry gets a reference (pre-job) number:  TRADE-YYMMDD-running number
    e.g. R-261017-000001 = Roofing enquiry on 17 Oct 2026, number 1.
  The running number never resets. When it becomes a real job it gets a J in
  front: JR-261017-000001. The trade letter is picked from the job type, or from
  what the customer wrote:
    B Building & renovations   C Concrete & cracks     W Waterproofing & leaks
    R Roofing & gutters        T Tiling                D Doors & windows
    G Gyprock & plaster        O Outdoor (decks, pergolas, fencing)
    F Painting & finishes      E Electrical            P Plumbing
    S Storm damage             Q Repair question       M General maintenance
  The number is in the email subject, at the top of the Telegram message, and the
  customer is told it. Every staff email ends with this trade code key.
  Enquiries are saved in data/mbs.db (SQLite, built into Node 22.5+).
  The table layout is in database/schema.sql.

  In this folder:
    node tools/jobs.mjs list                           recent enquiries
    node tools/jobs.mjs show R-261017-000001           all details, photos + the chat
    node tools/jobs.mjs convert R-261017-000001        make it a real job: JR-261017-000001
    node tools/jobs.mjs status R-261017-000001 contacted   (new, contacted, quoted, converted, lost)
    node tools/jobs.mjs codes                          what the trade letters mean
  Back up the data folder now and then: it holds every enquiry and photo.

JOB BRIEF FOR THE TEAM
  Every staff email and Telegram message starts with a "Job brief": one professional
  paragraph written by DeepSeek from the customer's answers, e.g. "Customer Sashi Sivam
  from Parramatta has asked for a quote to repaint the entire home, a four-bedroom,
  double-storey house...". It uses only what the customer said. The customer's exact
  answers are listed under it as "Job scope". If the AI is unavailable, the plain
  summary is used and the enquiry is still sent.

READ ALOUD AND LANGUAGES
  - The speaker button in Mr. Fixit's header turns his voice on or off (off by default).
  - The EN button picks the voice language: English, Polish, Tamil, Hindi, Chinese,
    Arabic, Vietnamese, Greek, Persian or Malay. The chat text stays in English.
  - How it works: DeepSeek translates each reply, then Azure Speech reads it out with a
    natural voice. This works on every phone and computer.
  - Set up Azure Speech once (free tier F0 = 500,000 characters a month):
      1. portal.azure.com > Create a resource > search "Speech" > Create
         (Pricing tier: Free F0, Region: Australia East)
      2. Open it > Keys and Endpoint > copy KEY 1 and the Location/Region
      3. Add to .env:   AZURE_SPEECH_KEY=your key
                        AZURE_SPEECH_REGION=australiaeast
      4. Restart the site and run the setup check: line 4 should show ✔
  - Without Azure, Mr. Fixit uses the device's own voices, and reads in English when the
    device has no voice for that language.
  - Speed: VOICE_RATE in .env (default +15%) for Azure voices; RATE in assets/fixit.js
    for device voices.

QUOTE QUESTIONS AND PHOTOS
  - Test the quote questions with your real DeepSeek key (type your answers):
      node --env-file=.env tools/check-setup.mjs --quote "I want to paint my entire house"
  - When the site starts, the window shows the version. If any file is from an older
    download it prints a WARNING listing them: unzip MBS_Website.zip over the folder,
    choose "Replace all", and restart. Your .env and data folder are never in the zip.
  - "Get a free quote": after the customer describes the job, Mr. Fixit (DeepSeek)
    asks up to 5 smart questions, one at a time, like an estimator would
    (e.g. painting a house: bedrooms, storeys, inside/outside, ceilings, condition).
    Tap-to-answer buttons and "Skip questions" are shown. The answers go to the team
    as "Job scope". Not asked for emergencies. If the AI is unavailable, this step
    is skipped and the enquiry still goes through.
  - Where a picture helps (leaks, cracks, roofs, painting, doors...), the customer is
    asked for up to 3 photos before the message goes to the team. Photos are shrunk
    on the customer's phone, attached to the email, sent to Telegram, and saved in
    data/photos/<reference>/. The contact form has a photo button too.
    Photos are never sent to the AI.

GOING PUBLIC LATER
  Running locally means the site works on this computer. To let customers use it
  from modernbuildingsolutions.com.au, this server needs to be reachable from the
  internet, for example with a free Cloudflare Tunnel, or by hosting the same folder
  on Netlify (netlify.toml is already included). Ask when you're ready.

BEFORE LAUNCH
  - Set area and hours in assets/fixit-kb.js (and SERVICE_AREA / BUSINESS_HOURS in .env)
  - Replace the [bracketed] placeholders on the pages
  - Replace the sample photos in /images (keep the same file names)
