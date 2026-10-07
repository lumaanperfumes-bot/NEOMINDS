# NeoMinds requests backend

This Google Apps Script backend stores contact requests and campus ambassador applications in a private Google Sheet, emails a receipt to the submitter, and provides an authenticated dashboard inbox with email replies.

## Deploy

1. Create a standalone project at [script.google.com](https://script.google.com).
2. Copy `Code.gs` into the script editor and add an HTML file named `Bridge` using `Bridge.html` for the hosted admin login and dashboard.
3. In `Code.gs`, change `SETTINGS.username` and `SETTINGS.password` to private credentials before deployment. The supplied defaults are temporary; do not publish them unchanged.
4. Run `setupNeoMindsBackend` once from the editor and authorize the requested Sheets and Mail permissions. This creates the spreadsheet and the two request tabs. Keep the spreadsheet private; the backend accesses it on behalf of its owner.
5. Deploy as a **Web app**, execute as **Me**, and set access to **Anyone** so the public forms can reach the backend. Google Workspace administrators may block public web apps; if so, deployment requires an administrator-approved account/settings.
6. Copy the deployed URL ending in `/exec`. For an existing deployment, edit it to use a **new version** after saving code changes; the `/exec` URL can remain the same.
7. Run `resetAdminCredentials` once after changing the credentials in `SETTINGS`.
8. In `NeoMinds Tech Hub (5).html`, set `BACKEND_URL` to the deployed `/exec` URL. It is currently set to the URL provided for NeoMinds. Publish the HTML and `logo.webp` together on an HTTPS host.

The footer `NEOMINDS` wordmark opens the hosted sign-in dashboard in a new tab. Contact and ambassador forms send JSON to `doPost`; the Apps Script stores the request and sends the receipt email. Admin sessions expire after six hours. Form receipt and admin reply email are sent by the Google account that owns the script and are subject to that account's Apps Script email quotas.

## Credential changes

Edit both `SETTINGS.username` and `SETTINGS.password` in the private Apps Script project, save, and run `resetAdminCredentials`. This writes only a salted password hash and the username to Script Properties. Do not put credentials or tokens in the website HTML.

The form requests use a no-CORS POST because Apps Script does not expose a readable cross-origin response. A successful browser request confirms delivery to the web app, but the static site cannot read an Apps Script validation error response. Check the script's executions and Sheet if a request is not visible.
