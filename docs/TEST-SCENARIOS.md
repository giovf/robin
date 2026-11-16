# Robin — user test scenarios

Work through these in order; later scenarios use what earlier ones create.
Tick each check as you go and note anything that looks wrong, slow or
confusing — the wording of a message counts.

**Before you start:** `npm run dev` is running, you are signed in at
http://localhost:3000, and you have one customer. Scenario 8 also needs
`npm run tunnel` running.

**Cost:** scenarios 4, 5, 6 and 7 call the Anthropic API (a few cents each).
Scenario 8 uses Recall.ai bot time. Everything else is free.

Status column: _checked_ = I ran this in a headless browser; _first run_ =
never exercised against the real service, so problems are most likely here.

| #   | Scenario                    | Status              |
| --- | --------------------------- | ------------------- |
| 1   | Sign-in and navigation      | checked             |
| 2   | Customers and solutions     | checked             |
| 3   | Upload and search           | checked             |
| 4   | Draft and read documents    | checked             |
| 5   | Diagrams                    | checked             |
| 6   | Phases                      | partly checked      |
| 7   | Simulated call              | checked             |
| 8   | Real meeting bot            | **first run**       |
| 9   | Google                      | **first run**       |
| 10  | Isolation between customers | checked (automated) |
| 11  | Export, archive, delete     | checked             |

---

## 1. Sign-in and navigation

1. Click **Sign out** (bottom of the sidebar), then open http://localhost:3000.
2. Try to sign in with a wrong password.
3. Sign in correctly.
4. Open http://localhost:3000/signup.

- [ ] Signed out, any page sends you to the login page.
- [ ] The wrong password gives a clear message and does not say whether the
      email exists.
- [ ] After sign-in you land on the dashboard and see your customer.
- [ ] Sign-up refuses a second account (v1 is single-user).
- [ ] You can reach every link in the sidebar with the Tab key alone, and
      the focused item is visibly outlined.

## 2. Customers and solutions

1. **Customers → New customer**: create "Test Co".
2. Open it, go to **Solutions → New solution**: name "Order platform
   renewal", any description.
3. Open the solution, edit its name on the Overview tab and **Save**.
4. Switch customers with the **Customer** drop-down in the sidebar.
5. Try to create a solution with an empty name.

- [ ] Creating the customer takes a few seconds (a database is created) and
      lands on its page.
- [ ] The solution shows status "Exploring" and phase "Discovery".
- [ ] The drop-down switches customer and the page follows.
- [ ] The empty name is refused with a readable message.

## 3. Upload and search

Use `docs/samples/acme-notes.txt`, plus any PDF or Word file of your own.

1. Customer → **Context sources** → choose the sample file → **Upload**.
2. Upload a PDF or `.docx` too. Then try an unsupported file (e.g. a `.png`).
3. Go to **Knowledge**. Open the uploaded item.
4. Search for `how long does month-end take` (words that are _not_ in the
   notes verbatim), then for `Lagerscanner` (German for warehouse scanner).

- [ ] Each upload reports success; the first one ever is slow (the language
      model, ~120 MB, downloads once).
- [ ] The unsupported file is refused with the list of accepted types.
- [ ] Knowledge lists the items with a readable text view.
- [ ] The first search finds the "nine working days" passage; the German
      search finds the scanner passage.
- [ ] Uploading the same file again does not create a duplicate.

## 4. Draft and read documents

1. Solution → **Documents**. Note the "Expected in the Discovery phase" box.
2. Click **Draft the discovery summary** → **Draft with Robin**. Watch the
   text stream in (20–40 s).
3. On the reading view: click entries in **In this document**; click a
   source under **Sources**; click **Download**; click **Print / PDF**.
4. Click **Edit**, change a sentence, check the preview updates as you type,
   **Save as new version**.
5. **History** → **Compare with current** on version 1 → **Read** version 1
   → restore version 1.
6. Draft a second document (**New document** → Requirements).
7. Customer → **Documents** (the tab beside Solutions). Click between items.

- [ ] The draft states only what the notes support, marks sources like
      `[S1]`, and lists what is unknown as open questions rather than
      inventing it.
- [ ] Outline links jump to the right heading.
- [ ] The download is a `.md` file; the print preview shows only the
      document (no sidebar, tabs or buttons).
- [ ] "Saved — version 2." appears and stays.
- [ ] The comparison shows what changed; restoring makes a version 3 and
      loses nothing.
- [ ] The library lists both documents under the solution and previews
      whichever you click; **Previous / Next** work on the reading view.
- [ ] There is no "Publish to Confluence" anywhere.

## 5. Diagrams

1. Solution → **Diagrams**. Type "Architecture", describe: "Current order
   flow from web shop to AS/400 and finance" → **Draw with Robin**.
2. In the editor, rename a box in the Mermaid source. Then break the syntax
   on purpose (delete a bracket).
3. **Download SVG** and **Download PNG**. **Save**.
4. Customer → **Documents**: click the diagram.

- [ ] The diagram renders and reflects the notes (web shop, SFTP, AS/400).
- [ ] The preview follows your edit within a second.
- [ ] Broken source shows an error under the editor, keeps the last good
      picture dimmed, and disables the downloads.
- [ ] Both downloads open correctly.
- [ ] The library previews the diagram.

## 6. Phases

1. Solution → **Overview** → **Advance to Solution design**.
2. Open **Documents**: the expected-documents box should now list design
   documents.
3. Use **Or move to a specific phase** to jump to **Delivery**.

- [ ] The phase shown beside the solution name changes each time.
- [ ] The expected documents change with the phase.
- [ ] Entering Delivery changes the status to "Going ahead".

## 7. Simulated call (no bot, free except the suggestions)

1. Stop the dev server. Add `MEETING_BOT_PROVIDER="fake"` to `.env`. Start
   `npm run dev` again.
2. Solution → **Calls**. Try to submit without ticking the consent box.
3. Enter `https://meet.google.com/abc-defg-hij`, tick consent, **Send Robin
   to the meeting**.
4. Copy the call page's address and, in a terminal, run
   `node scripts/simulate-call.mjs "<that address>"`.
5. Wait ~15 s. Click **Asked** on one suggestion and **Dismiss** on another.
6. Click **End call**. Then search **Knowledge** for `warehouse scanners`.
7. **Remove the `MEETING_BOT_PROVIDER` line again** and restart before
   scenario 8.

- [ ] Without consent the form will not submit.
- [ ] Transcript lines appear on their own, without reloading.
- [ ] Two or three suggested questions appear, each with a one-line reason,
      and they are worth asking (not things already answered in the call).
- [ ] Asked/dismissed suggestions move to the collapsed list.
- [ ] After ending, the call shows as ended and its transcript is findable
      in Knowledge.

## 8. Real meeting bot — first run

Setup: `npm run tunnel` is running, `WEBHOOK_BASE_URL` in `.env` matches the
address it printed, there is no `MEETING_BOT_PROVIDER` line, and the dev
server was restarted after the last `.env` change.

1. Start a Google Meet and **turn on captions (CC)**.
2. Solution → **Calls**: paste the Meet link, tick consent, send.
3. Admit "Robin" when Meet asks.
4. Speak for a minute about a made-up project: mention a deadline, a budget
   and one thing you are unsure of.
5. Click **End call**.

- [ ] Within ~30 s the status goes from joining to "Live — Robin is in the
      call." and Robin is visible to everyone in the meeting.
- [ ] Your words appear in the transcript a few seconds after you say them,
      under the right speaker name.
- [ ] Suggestions appear after ~30 s of talk.
- [ ] **End call** makes the bot leave the meeting.

If it fails, tell me which of these you saw:

- **An error right after sending** — Recall.ai refused the bot (often
  billing or an unsupported link). Copy me the message.
- **Bot joins, transcript stays empty** — captions are off, the tunnel
  stopped, or `RECALL_WEBHOOK_SECRET` does not match the Recall.ai
  dashboard. Look in the `npm run dev` terminal for
  `POST /api/webhooks/recall` lines: none = the tunnel/address; `401` = the
  secret; `200` = arriving, so tell me.
- **Stuck on "joining"** — nobody admitted the bot, or the meeting needs a
  signed-in account.

## 9. Google — first run

1. **Integrations** → Google → **Connect**. Approve on Google's screen. (An
   "unverified app" warning is expected in testing mode: Advanced →
   continue.)
2. Customer → **Context sources**. Under "Add from <your address>": add a
   **Gmail search** (e.g. `from:someone@example.com newer_than:30d` — pick
   something small), and add one small Drive folder.
3. Click **Sync …** on each.
4. Check **Knowledge**, then search for something you know is in one of
   those emails.
5. Solution → **Calls**: look at "From your calendar".
6. **Integrations** → disconnect Google.

- [ ] Google's consent screen asks only for _read_ access to Gmail, Drive
      and Calendar.
- [ ] You come back to Integrations with "Google is connected."
- [ ] Nothing is ingested until you add a source and sync it.
- [ ] Only the emails/files matching what you selected appear in Knowledge,
      and only under this customer.
- [ ] Upcoming meetings with a video link are offered on the Calls tab.
- [ ] After disconnecting, already-ingested items stay in Knowledge, and
      syncing a source tells you to reconnect rather than failing silently.

## 10. Isolation between customers

1. With documents and uploads under one customer, switch to the other.
2. Check its **Knowledge**, **Documents** and search for `AS/400`.
3. Copy the address of a document page, switch customer, and edit the
   address so the _other_ customer's ID is combined with that document ID.

- [ ] The other customer shows nothing from the first.
- [ ] The edited address gives "not found".

## 11. Export, archive, delete

Use the throwaway "Test Co" customer.

1. Customer → **Settings** → export.
2. **Archive customer**. Find it again from the Customers list and restore.
3. **Delete forever**: type the wrong name first, then the right one.

- [ ] The export is a JSON file containing the solutions, documents,
      transcripts and ingested text.
- [ ] An archived customer disappears from the sidebar and its pages give
      "not found" until restored; nothing is lost on restore.
- [ ] Deletion needs the exact name, and afterwards the customer is gone.

---

## Reporting back

For anything that fails, tell me the scenario number, the step, what you
expected and what happened; a screenshot helps. For 8 and 9, the last lines
in the `npm run dev` terminal are the most useful thing to paste.
