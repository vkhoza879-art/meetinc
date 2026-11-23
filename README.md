# MeetInc

MeetInc is a Firebase-backed appointment and customer-request app for small businesses. Customers create an account, browse business categories, select an offer, describe what they need, and request a meeting time with a backup time. Businesses manage their profile, prices, working hours, meeting requests, and chat. Booking and message updates sync in real time when both users are online.

The customer directory includes fictional sample businesses with sample logo marks, hours and prices so new users can explore the experience. Sample listings are clearly labelled and their booking flow is only a preview; they are not real businesses and requests are not sent. Live listings come from business profiles created in MeetInc.

## Firebase project

- Project: `meetinc-9072a` (MeetInc)
- Firestore: Enterprise Native mode, `africa-south1` (Johannesburg)
- Authentication: Email and password
- Hosting site: `meetinc-9072a`
- Front-end Firebase web configuration is in `public/app.js`. Firebase web API keys identify the project; Firestore Security Rules enforce access to user and booking data.

## Data access

The Firestore rules allow signed-in customers to discover business profiles and offers. Users can read only their own account record. A customer can create a request under their own account; only the customer and selected business can read it. The business can update appointment status and agreed time fields. Chat messages can be read and created only by either participant. Client-side writes are validated for field names, types, and length limits. Review the rules before broadly sharing the service.

## Run locally

Serve the `public/` folder over HTTP or HTTPS. Opening `index.html` as a `file://` URL will not load Firebase module imports correctly. On a computer with Node.js and Firebase CLI installed, from this folder run:

```powershell
firebase deploy --only firestore:rules,hosting
```

Then visit `https://meetinc-9072a.web.app`. For a local hosting preview, run `firebase emulators:start --only hosting,auth,firestore` after configuring local Firebase emulators. The app currently points to the live MeetInc Firebase project, so locally created accounts and requests are live project data.

## Customer payments (prepared, not yet live)

The app now has customer checkout and business payout setup, with payment handling in `functions/index.js`. A customer can pay a fixed-price Rand offer after the business confirms the appointment. Paystack hosts checkout; the server verifies signed payment events and checks the transaction with Paystack before marking an appointment paid. Paystack subaccounts route the business share to its connected South African bank account. MeetInc's platform fee and who pays Paystack processing fees are deployment settings and must be chosen before payout accounts can be connected. Paystack processing fees also apply.

To activate payments:

1. Link a Google Cloud billing account to Firebase project `meetinc-9072a` and upgrade it to Blaze. Cloud Functions cannot deploy on the current Spark plan.
2. Create and verify a Paystack South Africa account, enable subaccounts/split payments, and start with its test secret key.
3. From this folder, save the secret with `firebase functions:secrets:set PAYSTACK_SECRET_KEY` and deploy with `firebase deploy --only functions`. The selected payment terms are set in `functions/.env.meetinc-9072a`: MeetInc keeps 10%, and the business payout covers Paystack's processing fees.
4. Add the deployed `paystackWebhook` URL in Paystack's dashboard. The server marks a payment paid only after signature and transaction verification.
5. Test booking, payment and refunds in Paystack test mode before switching to live keys. Refunds and disputes currently need to be handled in Paystack. Confirm Paystack's South African account and subaccount verification requirements before onboarding live businesses; the current form asks the business owner to confirm their bank details and does not collect ID documents.

Never put a Paystack secret in `public/app.js`, website HTML, or a public repository. Business bank details are sent to Paystack; MeetInc keeps only the Paystack subaccount code and masked account details. This version supports fixed-price ZAR offers and South African bank payouts.

## Known limits

- Browser alerts appear only while the business dashboard is open and the browser has granted notification permission; reliable background push needs a service worker and Firebase Cloud Messaging setup.
- The "call" action opens the device's phone dialer. In-app voice calls are not implemented.
- Customers suggest a time; businesses confirm or decline the request. This first version does not reserve a time slot against overlapping requests automatically.
- Firebase Hosting is live at `https://meetinc-9072a.web.app`.
- Branding is MeetInc with the V mark. Payments are not live until Firebase billing, Paystack credentials, webhook setup and the platform fee are configured.
- Search crawler guidance is published in `public/robots.txt`, with the public landing page listed in `public/sitemap.xml`. Ownership was verified in Google Search Console and the sitemap was submitted. Search Console initially reported it could not read the sitemap even though the public URL returns successfully; Google may need time to retry it.
- Google Search Console reported the homepage is not yet indexed. A manual indexing request could not be submitted because the account hit Google's daily request quota; retry the request tomorrow in URL Inspection.
