# AFS Spectroscopy Assistant — frontend

React + Vite + TypeScript + Tailwind UI for the AFS in-line spectroscopy assistant. It implements the contract in `frontend.md` (routes, SSE events, `Report` types) and runs against the real backend or a built-in mock.

## Run it

```bash
npm install
npm run dev
```

With no `VITE_API_BASE_URL` set, the app uses an in-browser **mock backend** (the header shows "Mock data"). The mock replays a full run for the soil example from the challenge brief, whatever you type: clarifier questions, researcher tool calls, a critic rejection, a revision, then the report. Its answer is labelled "Mock replay, not your enquiry". `/reports` shows the organizers' D01/D02 worked examples. None of the mock content is assistant output.

To use the real backend, create `.env.local`:

```
VITE_API_BASE_URL=https://afs-backend.onrender.com
```

To use the backend's own mock instead, run it with `MOCK_MODE=1` and point `VITE_API_BASE_URL` at it.

Checks: `npm run typecheck`, `npm run build`.

## Deploy (Vercel)

Project root: `frontend`. Build command `npm run build`, output `dist`. Set `VITE_API_BASE_URL` in the Vercel project. `vercel.json` already has the SPA rewrite. Send the Vercel URL to the backend owner for `CORS_ORIGINS`.

Optional, local demos only: copy the source PDFs into `public/materials/` (git-ignored) and set `VITE_MATERIALS_URL=/materials/` to get "Original PDF page" links in the source drawer. Don't do this on a public deployment: the PDFs are copyrighted.

## What's on screen

| Route | Purpose |
|---|---|
| `/` | **Compose**: the AFS prism, one input, Examples (all 14 scenarios) and H01–H06 chips. **Ask questions first** on means interactive mode, off means batch mode. After sending, a **chat** in the middle (questions, the prism while agents work, then answers) with the **agent log on the right**. Ask more below the latest answer. |
| `/reports`, `/reports/:caseId` | Precomputed H01–H06 and D01–D08 reports from `/outputs`, shown as the same answer, with "Run this enquiry live" |
| `/sources` | Knowledge base: sources with evidence levels, fiber transmission chart, S01 Table 1 |

The layout follows chat apps like Claude: a **left sidebar** with New assessment, Reports, Knowledge base and **Recent chats** (newest first, each with all its questions; folds away on desktop, a slide-in menu on phones), and a slim top bar with the backend status and a dark/light theme switch (dark by default, light for projectors). Text follows one scale: 16 px body, 14–15 px secondary text, 13 px labels, 12 px badges.

**Chats.** After an answer, type a follow-up below it: a question about the case or what the customer told you. The backend assesses one enquiry per run, so a follow-up is sent as the whole conversation: the first enquiry, the customer's answers to the Clarifier, earlier follow-ups and the new message (the log shows it under "What the agents received"; 4000 characters at most). Earlier answers fold to their verdict; "Show the answer" opens them and "Its agent log" or the numbered buttons above the log switch the log to that question. Chats, with their answers and logs, are kept in this browser's `localStorage` (separately for the mock and each backend URL), so Recent reopens them after a reload even if the server no longer has the runs.

**Agent log** (the right column, always visible; on phones it sits below the chat and folds once the answer is ready): the four agents as a relay with the active one lit, then every step in plain words: what the Researcher searched for and which source pages it found, the Critic's rejections and what the Writer changed. With several questions in a chat, numbered buttons switch between their logs.

**While the agents work**, the middle of the screen shows the run as light through the AFS prism: the customer enquiry card sends one beam into the prism, it splits into four rays, one per agent, and the ray and card of the agent at work light up (a red ray when the Critic sends a draft back). In interactive mode the Clarifier's questions appear below it, one card at a time. On phones the rays give way to a small prism above the four agents.

**Answer**: when the run finishes, one answer sheet takes the prism's place.

- **Verdict**: decision status on the decision scale (the assistant never reaches "validated"), why, the summary, customer assumptions the sources contradict or don't confirm, and the Critic's check.
- Four short parts, each marked with the agent that wrote it: **Test first** (methods with one reason each, plus a fiber check against S02 p.6 that warns when the customer's fiber can't carry the method's range), **Ask the customer** (top three questions, "Copy as an email"), **First experiment** (steps and the go/no-go basis) and **Watch out** (top risks).
- **Open the full report** for every chapter, with a highlighter for facts, sourced claims, assumptions and inferences. Export: Markdown, JSON, Print/PDF.
- **Traceable both ways**: point at a source chip in the answer and the log step that found it lights up and scrolls into view; point at an agent in the log and the parts it wrote are outlined.

Every citation chip previews the source and page on hover; clicking opens the page text from `/kb/{source}/pages/{page}`, highlights the quoted passage, and says whether the quote was found on that page.

**Motion details** follow [Magic UI](https://magicui.design/), [SmoothUI](https://smoothui.dev/) and [Unlumen UI](https://ui.unlumen.com/), rebuilt in plain CSS so no animation library is needed (`src/components/motion.tsx`, "Motion details" in `src/index.css`): light rays and a border beam on the landing input, example ideas cycling in it, shimmering live status text, rolling timer digits, a beam around the working agent's card, log steps that slide in, a light sweep and blur-in when the answer arrives, faded edges on the log, a pointer spotlight on report cards, and a circular reveal when switching theme. All of it stops for `prefers-reduced-motion`.

## Sign-in

The app has a JWT sign-in screen. It appears when the backend's `/health` says `auth_required` or a request answers 401. After sign-in, every request carries `Authorization: Bearer <token>` (the live events stream sends `?access_token=`, because `EventSource` cannot set headers). An expired token sends the person back to sign-in, the sidebar shows who is signed in with a Sign out button, and each person's chats are stored separately in the browser. The backend side (login endpoint, token check, CORS) is specified with ready-to-paste FastAPI code in [AUTH.md](AUTH.md). The mock backend asks for sign-in too, with the demo accounts in `src/mock/users.json`.

## Notes for the backend owner

- **Proceed with assumptions** sends any answers already typed along with `proceed_with_assumptions: true`, so nothing the expert typed is thrown away.
- **Spectral chart**: the UI reads the first `a–b unit` range in `range_text` (nm, µm or cm⁻¹), e.g. `780–2500 nm (nominal method range)` or `4000–400 cm⁻¹`. Ranges it can't parse still show in the table.
- **Citations**: `page` is 1-based. Keep `quote` verbatim so the drawer can find and highlight it. Inline references like `[S01 p.10]` inside text fields are also turned into chips.
- **Fiber families, method table and page topics** are static data from the supplied materials in `src/lib/kb-data.json`.
- Partial or missing fields never crash the view; empty lists show "None stated".

## Code map

```
src/api/types.ts                  contract types from frontend.md §3
src/api/client.ts                 fetch + EventSource client (dedupes replayed events)
src/api/mock.ts                   in-browser mock backend
src/lib/run.tsx                   run state machine (§5): reconnect, polling fallback, ?thread= restore, chats and follow-ups
src/lib/data.tsx                  health with cold-start retries, cases, sources, outputs
src/lib/kb.ts, spectral.ts        fiber families, method table, wavelength parsing and coverage
src/lib/ui-state.ts               tooltip, source drawer, and the log/answer highlight link
src/components/shell.tsx          header, backend status, recent runs, theme
src/components/brand.tsx          AFS logo and the SVG prism
src/components/compose.tsx        the landing input and the input box used for follow-ups
src/components/agent-log.tsx      the always-visible agent log
src/components/answer.tsx         the answer sheet, full report panel, export, fiber check
src/components/dispersion.tsx     the prism stage shown while the agents work, with the clarifier's questions
src/components/question-deck.tsx  clarifier questions, one card at a time
src/components/report.tsx         chapter renderers used by the full report and print
src/pages/                        studio (/, the chat), reports, sources
```
