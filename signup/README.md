# Theme board

A page where invited friends set a nickname, say if they are coming, and claim one theme. The rows live in a Google Sheet that only you open. Send friends the web app link.

Your name for them stays in the `inviteName` column. The name they type is `displayName`. When you paste the sheet back here, both are on the same row.

## Put it online

1. Create a blank Google Sheet. Name it `Quizz In board`. Do not share the sheet.
2. **Extensions → Apps Script**. Delete the sample code in `Code.gs` and paste `signup/Code.gs` from this repo.
3. Change `HOST_PIN` at the top of `Code.gs` before you deploy. A value in the sheet cell `Config!hostPin` overrides it later, so you can rotate the PIN without a new deploy.
4. Next to **Files**, click **+ → HTML** and name the file exactly `Index`. Replace the stub with `signup/Index.html`.
5. **Project settings** (gear) → set the timezone to yours. The lock date uses that timezone.
6. **Deploy → New deployment →** select type **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Authorize the script (Advanced → continue, if Google says it is unverified). Copy the web app URL. That is the link for friends.
8. Open the URL, unlock **Host** with the PIN, and add each person by the name you know them by.

Friends never sign in. The script runs as you, so only you approve access to the sheet.

After you change the code, paste the new file into the Apps Script editor, then **Deploy → Manage deployments → pencil → Version: New version → Deploy**. The URL stays the same. Redeploying without pasting the new `Index` leaves the old page online.

You can preview the page on this computer by opening `signup/Index.html` in a browser. That copy uses local storage and the PIN `1234`. It does not touch Google.

## Shorter link

Friends can use `https://baptistepauletto.github.io/quizz/` instead of the long Apps Script address. After it opens, the address bar still shows `script.google.com`.

1. Paste the web app URL (it ends in `/exec`) into `BOARD_URL` in `docs/index.html`.
2. Push that file to `main`.
3. On GitHub: **Settings → Pages → Deploy from branch → main → /docs → Save.** The first time, the link can take a minute to appear.

## Columns

`Players`: `id`, `inviteName`, `displayName`, `coming` (`in`, `unsure`, `out`), `theme`, `updatedAt`.

`Config`: `lockAt` (`YYYY-MM-DD`, editable through that day), `hostPin`.

Row order is the order on the page. Someone marked **Can't** no longer claims their theme.
