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
| 22 | 1.0.22 | 2026-11-13 01:51 | GKH-Project-Champ | _this commit_ | _see git log_ |
