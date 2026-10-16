# AFS Spectroscopy Assistant — frontend

React + Vite + TypeScript + Tailwind UI for the AFS in-line spectroscopy assistant. It implements the contract in `frontend.md` (routes, SSE events, `Report` types) and runs against the real backend or a built-in mock.

## Run it

```bash
npm install
npm run dev
```

With no `VITE_API_BASE_URL` set, the app uses an in-browser **mock backend** (the header shows "Mock data"). The mock replays a full run for the soil example from the challenge brief, whatever you type: clarifier questions, researcher tool calls, a critic rejection, a revision, then the report. `/reports` shows the organizers' D01/D02 worked examples. None of the mock content is assistant output.

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

A chat interface, like ChatGPT or Claude: type the customer's enquiry, press Enter, and the assistant answers in the conversation.

| Route | Purpose |
|---|---|
| `/` | The chat. Empty state with suggested H01–H06 enquiries; then your enquiry, the assistant's activity, its questions and its answer. Send another enquiry to add a new assessment below. |
| `/reports`, `/reports/:caseId` | Precomputed H01–H06 and D01–D08 reports from `/outputs`, shown as a conversation, with "Run this enquiry live" |
| `/sources` | Knowledge base: sources with evidence levels, fiber transmission chart, S01 Table 1 |

The sidebar has New assessment, the two pages above, and Recent runs (kept in `localStorage` for the real backend; reopened through `GET /assessments/{id}`). On phones it slides in from the menu button.

In the composer, **Ask questions first** on means interactive mode, off means batch mode. **Examples** lists all 14 scenarios.

How one assessment reads in the chat:

- **Activity strip**: the four agents as a small pipeline with a live status line ("Researcher is searching the AFS sources"). It opens to the full trace while agents work and folds to "Worked for 56 s. Critic passed after 2 revisions" when done.
- **Questions**: the clarifier's questions arrive as a form inside the chat. Send answers, or proceed with assumptions; the round then folds to "You answered 1 of 6 questions".
- **Answer**: decision status with the decision scale (the assistant never reaches "validated"), rationale and summary, then folds. Premise check, recommended methods and the first experiment start open; questions, requirements, measurement concept, spectral range and fiber fit, risks, sources and critic verification start closed, each with a one-line summary. Message actions: Expand all, Markdown, Copy JSON, Print.

Every citation chip previews the source and page on hover; clicking opens the page text from `/kb/{source}/pages/{page}`, highlights the quoted passage, and says whether the quote was found on that page.

## Notes for the backend owner

- **Proceed with assumptions** sends any answers already typed along with `proceed_with_assumptions: true`, so nothing the expert typed is thrown away.
- **Spectral chart**: the UI reads the first `a–b unit` range in `range_text` (nm, µm or cm⁻¹), e.g. `780–2500 nm (nominal method range)` or `4000–400 cm⁻¹`. Ranges it can't parse still show in the table.
- **Citations**: `page` is 1-based. Keep `quote` verbatim so the drawer can find and highlight it. Inline references like `[S01 p.10]` inside text fields are also turned into chips.
- **Fiber families, method table and page topics** are static data from the supplied materials in `src/lib/kb-data.json`.
- Partial or missing fields never crash the view; empty lists show "None stated".

## Code map

```
src/api/types.ts            contract types from frontend.md §3
src/api/client.ts           fetch + EventSource client (dedupes replayed events)
src/api/mock.ts             in-browser mock backend
src/lib/run.tsx             run state machine (§5): reconnect, polling fallback, ?thread= restore, chat turns, recent runs
src/lib/data.tsx            health with cold-start retries, cases, sources, outputs
src/components/shell.tsx    sidebar, top bar, backend status, theme
src/components/chat.tsx     user and assistant messages, one assessment per turn
src/components/composer.tsx chat input, examples menu, questions-first switch
src/components/             activity strip, questions, answer folds, source drawer, spectral chart
src/pages/                  chat, reports, sources
```
