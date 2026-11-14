# GKH Project Champ: build registry

Every commit gets the next build number (git pre-commit hook, `tools/build-bump.mjs`) and a row here.
The row is completed with the commit id and title by the next commit. The commit message carries `Build: N`,
so `git log --grep "Build: 12"` finds it. Each Netlify deploy records its build, commit and deploy id in the
console under **Admin > Builds**, and publishes them at `/build.json`.

Version = product version + build number (1.0.12 = version 1.0, build 12). Times are Sydney time.

| Build | Version | Date | Branch | Commit | Change |
|---|---|---|---|---|---|
| 1 | 1.0.1 | 2026-11-12 09:07 | GKH-Project-Champ | `b30ce4c` | GKH Project Champ PC 1.0: project element of the test console as its own product |
| 2 | 1.0.2 | 2026-11-12 09:11 | GKH-Project-Champ | `87fb43e` | BOM on/off slider per project; login page hides the contractor project-code box |
| 3 | 1.0.3 | 2026-11-12 19:25 | GKH-Project-Champ | `e1efd8d` | Champ assistant (multilingual chat) and a one-click light/dark slider |
| 4 | 1.0.4 | 2026-11-12 19:38 | GKH-Project-Champ | `b4982a6` | Page language on the fly, Champ voice (Azure, Australia East), glow, top-right controls, logo far left |
| 5 | 1.0.5 | 2026-11-12 19:39 | GKH-Project-Champ | `fa4fb7a` | Netlify: don't treat LLM_MAX_TOKENS (a plain number) as a secret; it blocked deploys |
| 6 | 1.0.6 | 2026-11-12 20:37 | GKH-Project-Champ | `3925147` | Delete projects (board menu, Summary bulk delete, Projects list, plan page) |
| 7 | 1.0.7 | 2026-11-12 20:53 | GKH-Project-Champ | `7ef55dc` | ⚙ Modules: switch BOM and SWMS on or off per project |
| 8 | 1.0.8 | 2026-11-12 21:01 | GKH-Project-Champ | `37fd2a5` | Ask AI for projects, programs and the portfolio; programs; no chat bubble in the console |
| 9 | 1.0.9| 2026-11-12 21:36| GKH-Project-Champ| `fd1241a` | Project Champ: automatic build numbers and a build registry |
| 10 | 1.0.10| 2026-11-12 21:47| GKH-Project-Champ| `04e888b` | Champ: seamless language switching and a main menu |
| 11 | 1.0.11| 2026-11-12 21:50| GKH-Project-Champ| `c9e9f4f` | Champ: long menu labels wrap instead of scrolling sideways; a blocked autoplay waits quietly for the Listen button |
| 12 | 1.0.12| 2026-11-12 22:21| GKH-Project-Champ| `51cb23e` | Champ: speak or type in any language (🎤 with Azure language identification) |
| 13 | 1.0.13| 2026-11-12 22:28| GKH-Project-Champ| `c2941dc` | Champ ears: Portuguese listens as pt-PT (pt-BR is refused in australiaeast); one automatic retry when Azure is busy |
| 14 | 1.0.14| 2026-11-12 22:30| GKH-Project-Champ| `7b9968a` | Champ ears: 'any language' mode (Azure multilingual model, no list) |
| 15 | 1.0.15| 2026-11-12 22:33| GKH-Project-Champ| `39412c4` | Champ ears: two listening modes, My languages (accurate, Tamil/Malay/Persian) and Any language (incl. Portuguese) |
| 16 | 1.0.16| 2026-11-13 00:13| GKH-Project-Champ| `a21f802` | Share preview: GKH Project Champ card with the globe (WhatsApp, LinkedIn, X); globe icons replace the MBS ones |
| 17 | 1.0.17| 2026-11-13 00:50| GKH-Project-Champ| `bcc5498` | Share preview: new file names for every GKH logo (WhatsApp kept the old MBS icon by file name); globe centred so a square thumbnail shows it |
| 18 | 1.0.18| 2026-11-13 01:07| GKH-Project-Champ| `e45b12f` | Champ welcome: language first ("switch to …" any time), then name, phone with country code, email read back to confirm, welcome package; eve |
| 19 | 1.0.19| 2026-11-13 01:25| GKH-Project-Champ| `91b30dd` | Cinematic 10-second intro on the home page (Plan, Gantt chart, critical path, PM tools, title) with a live hero score; visitor counter in th |
| 20 | 1.0.20| 2026-11-13 01:35| GKH-Project-Champ| `8a4b655` | Champ welcome: the Main menu link no longer ends the questions (☰ only pauses them for this visit); visitors who shared nothing are greeted  |
| 21 | 1.0.21| 2026-11-13 01:41| GKH-Project-Champ| `7c5a49e` | Intro start screen: pick your language (English by default); the intro, the website and Champ all follow, and Champ greets in it and goes st |
| 22 | 1.0.22| 2026-11-13 01:51| GKH-Project-Champ| `ca713c4` | Voice input: answer inside Netlify's 10-second limit (clear 'too long' message, one retry only when there's time), show the real reason on e |
| 23 | 1.0.23| 2026-11-13 01:57| GKH-Project-Champ| `828de2b` | Champ hands-free: switch the microphone on and Champ listens after each question (and after each spoken answer); 'Hey Champ' wakes it; say ' |
| 24 | 1.0.24| 2026-11-13 02:00| GKH-Project-Champ| `93092e9` | Intro start screen: language picker on one line |
| 25 | 1.0.25| 2026-11-13 02:05| GKH-Project-Champ| `d39afb9` | Intro: language picker at the bottom left |
| 26 | 1.0.26| 2026-11-13 02:08| GKH-Project-Champ| `cc46145` | Voice: Champ listens in the chosen language for the welcome answers (name, phone; email in English), and a short answer Azure can't place is |
| 27 | 1.0.27| 2026-11-13 02:29| GKH-Project-Champ| `4b9cd89` | Champ welcome rebuilt: greeting, language by voice or tap, then a typed form (first and last name, phone with country code, email, reason fo |
| 28 | 1.0.28| 2026-11-13 02:32| GKH-Project-Champ| `2431460` | Champ form: consent tick beside its text |
| 29 | 1.0.29| 2026-11-13 08:32| GKH-Project-Champ| `e14508f` | Not remembering visitors for now (one switch, CHAMP_REMEMBER, to turn it on later): every new visit starts fresh in English with the greetin |
| 30 | 1.0.30| 2026-11-13 08:45| GKH-Project-Champ| `9620768` | Home: 'Ask Champ' section for project questions (answered first, then the welcome); Contact: enquiry form with the PDPA notice and consent,  |
| 31 | 1.0.31| 2026-11-13 08:46| GKH-Project-Champ| `8848140` | Contact form: thank-you box hidden until sent; ticks and radio buttons beside their labels |
| 32 | 1.0.32| 2026-11-13 08:53| GKH-Project-Champ| `ab89012` | Voice: listening that starts by itself now hears you (sound meter resumed and tuned to the room, never drops a recording silently); short sp |
| 33 | 1.0.33| 2026-11-13 09:17| GKH-Project-Champ| `ca07b38` | Champ: chat capped at 2000 tokens per question (shorter instructions, recent conversation trimmed to fit, 450-token answers) and a more natu |
| 34 | 1.0.34| 2026-11-13 09:25| GKH-Project-Champ| `e853f5a` | About page: GKH introduction from gkhconsultancy.com (since 2010, 8 countries, 14 with partners, seven practices, selected national programs |
| 35 | 1.0.35| 2026-11-13 20:43| GKH-Project-Champ| `c13152e` | Programs and projects in two levels: Programs are real records (manager, sponsor, objective, status, colour, target dates) and every project |
| 36 | 1.0.36| 2026-11-13 21:04| GKH-Project-Champ| `18851fa` | Project Intelligence re-plan on the fly: a re-plan question (new length, finish date or budget, review gates) becomes a worked-out task-by-t |
| 37 | 1.0.37| 2026-11-13 21:34| GKH-Project-Champ| `869499c` | Project page (was Job): Client & project details, the stage path Pre-sales → Proposal submitted → Invoiced (milestone payments 1 to 12, amou |
| 38 | 1.0.38| 2026-11-13 22:03| GKH-Project-Champ| `eb9f6c2` | Project types: 7 GKH practices x 4 consulting types; About links to the GKH website |
| 39 | 1.0.39| 2026-11-14 00:18| GKH-Project-Champ| `4935df7` | Project types: General and fun projects for learning project management |
| 40 | 1.0.40| 2026-11-14 01:11| GKH-Project-Champ| `f6e2e45` | Project types: one program per category, link related projects |
| 41 | 1.0.41| 2026-11-14 01:14| GKH-Project-Champ| `7e2e50b` | Project types: one program per category, link related projects |
| 42 | 1.0.42| 2026-11-14 01:38| GKH-Project-Champ| `6f6e2de` | Change control records kept for good; no cooling-off or emergency; types fit the Finish by date |
| 43 | 1.0.43| 2026-11-14 02:25| GKH-Project-Champ| `a2f8e8b` | Budget window, designed project charter and 20-page project plan (PDF and Word), in the chosen language |
| 44 | 1.0.44| 2026-11-14 03:10| GKH-Project-Champ| `4f4b6d3` | Sticky notes on tasks (Kanban and Gantt); Khmer (Cambodian) language |
| 45 | 1.0.45| 2026-11-14 10:15| GKH-Project-Champ| `c736a59` | Charter and plan: fully in the chosen language; colour schemes |
| 46 | 1.0.46| 2026-11-14 10:42| GKH-Project-Champ| `e6d9154` | Sticky notes: edit in place, tick boxes, checklists |
| 47 | 1.0.47| 2026-11-14 11:08| GKH-Project-Champ| `03de9c4` | Project types: 16 cloud projects |
| 48 | 1.0.48| 2026-11-14 12:15| GKH-Project-Champ| `2fa9b18` | Whole console in the chosen language; Costing with the signed-off BOM; change control as a module; no Inventory; draggable notes |
| 49 | 1.0.49| 2026-11-14 15:17| GKH-Project-Champ| `f9a3767` | BOM: delete, one per project, opens from the costing; signed budget approval |
| 50 | 1.0.50| 2026-11-14 16:09| GKH-Project-Champ| `deb4d59` | Champ: this-week card, cost follows progress, Things to order, Inventory removed, script typography |
| 51 | 1.0.51| 2026-11-14 16:56| GKH-Project-Champ| `6ff0fa4` | Champ: Sign in with Google only shows with a real OAuth client ID |
| 52 | 1.0.52| 2026-11-14 17:22| GKH-Project-Champ| `4b22a35` | Champ: add level-1 tasks anywhere (schedule and Kanban) with their costing |
| 53 | 1.0.53| 2026-11-14 17:49| GKH-Project-Champ| `40028c9` | Champ: Users & access reworked: super user, project managers, contractors, project personnel, Google view only |
| 54 | 1.0.54| 2026-11-14 18:09| GKH-Project-Champ| `59a1dc5` | Champ: sticky notes save with Enter; all done turns the note blue with a tick |
| 55 | 1.0.55| 2026-11-14 19:12| GKH-Project-Champ| `b9b451a` | Champ: People rebuilt: two groups, credentials, resume, rate per hour, My profile, team calendar, workload |
| 56 | 1.0.56| 2026-11-14 19:32| GKH-Project-Champ| `223b460` | Champ: rates in plain $ (no AUD): People form and AI prompts are not tied to a country |
| 57 | 1.0.57| 2026-11-14 19:50| GKH-Project-Champ| `38c8792` | Champ: picking a program on New project fills in its details |
| 58 | 1.0.58 | 2026-11-14 21:07 | GKH-Project-Champ | _this commit_ | _see git log_ |
