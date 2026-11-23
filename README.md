# MeetInc

MeetInc is a Firebase-backed appointment and customer-request app for small businesses. Customers create an account, browse business categories, select an offer, describe what they need, and request a meeting time with a backup time. Businesses manage their profile, prices, working hours, meeting requests, and chat. Both roles can edit their account profile, choose a built-in avatar or upload a small profile photo, and link a Google sign-in. Booking and message updates sync in real time when both users are online.

The customer directory includes fictional sample businesses with sample logo marks, hours and prices so new users can explore the experience. Sample listings are clearly labelled and their booking flow is only a preview; they are not real businesses and requests are not sent. Live listings come from business profiles created in MeetInc.

## Voice calls and push alerts

After a real booking, customers and businesses can place browser-based voice calls from its chat. When MeetInc is open, an incoming call displays an answer/decline prompt and rings with sound and vibration. Calls use the microphone and WebRTC audio with STUN discovery; both people must be online in MeetInc and grant microphone access. Some restrictive networks may need a TURN relay for reliable connections. When MeetInc is in the background, a subscribed device receives a high-priority call alert with its system notification sound; this is not a native full-screen phone-call interface.

Each browser or installed app must choose **Enable push notifications** and grant notification permission. The deployment workflow publishes the Firebase Cloud Functions that send booking, message, and call alerts. Background delivery requires an active Firebase Blaze billing account, the GitHub deploy service account to have Cloud Functions deployment permissions, and the device push service to be available. Android notifications use dedicated update and call channels with vibration and sound. iOS background alerts also require an Apple Push Notifications key configured in Firebase. The installed Android app must be rebuilt to receive the native channel and listener changes.

## Native mobile app

MeetInc is packaged for Android and iOS with Capacitor. The native shells include the same MeetInc experience and use the native push plugin; the Firebase notification functions can send to either web or native device tokens.

Requirements: Node.js 22+, Android Studio and an Android SDK for local Android builds, and macOS with Xcode for iOS builds. From the project folder:

```powershell
pnpm install
pnpm run native:add:android
pnpm run native:prepare
pnpm run native:open:android
```

The Android and iOS app IDs are registered in Firebase. Their Firebase client configuration files are downloaded into the native projects but intentionally kept out of Git. On a new checkout, create them with `firebase apps:sdkconfig ANDROID 1:802867466895:android:1d2ea1a53b7ec5a16656fa --out android/app/google-services.json` and `firebase apps:sdkconfig IOS 1:802867466895:ios:7f9fac5fe063effd6656fa --out ios/App/App/GoogleService-Info.plist`. Firestore rules protect customer data. Native push still needs the Firebase notification functions deployed, and iOS push additionally needs an Apple Push Notifications key configured in Firebase and an Apple Developer account. The Android workflow creates a debug APK artifact on GitHub Actions; download it from the latest **Build MeetInc Android app** run to install it manually. Google Play release requires a signed Android App Bundle; App Store release requires a signed archive from macOS/Xcode and the respective developer accounts. Store submissions are not automated yet.

## Firebase project

- Project: `meetinc-9072a` (MeetInc)
- Firestore: Enterprise Native mode, `africa-south1` (Johannesburg)
- Authentication: Email and password. Enable the Google provider in Firebase Authentication before using Google sign-in or account linking.
- Hosting site: `meetinc-9072a`
- Front-end Firebase web configuration is in `public/app.js`. Firebase web API keys identify the project; Firestore Security Rules enforce access to user and booking data.

## Data access

The Firestore rules allow signed-in customers to discover business profiles and offers. Users can read and update only permitted fields on their own account record; their account type cannot be changed. Business profile pictures are part of the public business listing. A customer's picture is shared with a business only on that customer's booking requests. A customer can create a request under their own account; only the customer and selected business can read it. The business can update appointment status and agreed time fields. Chat messages can be read and created only by either participant. Uploaded profile pictures are resized and compressed in the browser before saving. Client-side writes are validated for field names, image format and length. The GitHub Hosting workflow deploys both Hosting and Firestore rules.

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

- Voice calls use the microphone and WebRTC after both participants grant permission. Calls work best when both users are online; restrictive networks may require a TURN relay. In-app ringing works while MeetInc is open; background calls use a push alert rather than CallKit/Android Telecom integration.
- Push delivery requires the notification Cloud Functions deployment to succeed and each device to opt in. Android installed-app channel changes require a newly built APK.
- Android/iOS Capacitor project setup is documented in the Native mobile app section; app store distribution still requires platform-specific signing and store accounts.
- Customers suggest a time; businesses confirm or decline the request. This first version does not reserve a time slot against overlapping requests automatically.
- Firebase Hosting is live at `https://meetinc-9072a.web.app`.
- Branding is MeetInc with the V mark. Payments are not live until Firebase billing, Paystack credentials, webhook setup and the platform fee are configured.
- Search crawler guidance is published in `public/robots.txt`, with the public landing page listed in `public/sitemap.xml`. Ownership was verified in Google Search Console and the sitemap was submitted. Search Console initially reported it could not read the sitemap even though the public URL returns successfully; Google may need time to retry it.
- Google Search Console reported the homepage is not yet indexed. A manual indexing request could not be submitted because the account hit Google's daily request quota; retry the request tomorrow in URL Inspection.
