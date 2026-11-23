const crypto = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');

initializeApp();
const db = getFirestore(undefined, 'default');
const paystackSecret = defineSecret('PAYSTACK_SECRET_KEY');
const platformFee = defineString('MEETINC_FEE_PERCENT');
const feeBearerSetting = defineString('MEETINC_PAYSTACK_FEE_BEARER');
const region = 'africa-south1';
const paystackApi = 'https://api.paystack.co';
const webAppUrl = 'https://meetinc-9072a.web.app/';

async function notifyUser(uid, title, body, tag, { type = 'update', urgent = false } = {}) {
  const tokens = await db.collection('pushTokens').where('ownerUid', '==', uid).get();
  if (tokens.empty) return;
  for (let i = 0; i < tokens.docs.length; i += 500) {
    const batch = tokens.docs.slice(i, i + 500);
    const result = await getMessaging().sendEachForMulticast({
      tokens: batch.map(d => d.data().token),
      notification: { title, body },
      data: { title, body, tag, url: webAppUrl, type },
      webpush: {
        headers: { Urgency: 'high', TTL: '3600' },
        notification: {
          tag,
          icon: `${webAppUrl}icons/meetinc.svg`,
          requireInteraction: urgent,
          renotify: urgent,
          vibrate: urgent ? [250, 120, 250, 500, 250] : [120, 80, 120]
        },
        fcmOptions: { link: webAppUrl }
      },
      android: {
        priority: 'high',
        notification: {
          channelId: urgent ? 'meetinc_calls' : 'meetinc_updates',
          sound: 'default',
          notificationPriority: urgent ? 'PRIORITY_MAX' : 'PRIORITY_DEFAULT'
        }
      },
      apns: {
        headers: { 'apns-priority': urgent ? '10' : '5' },
        payload: { aps: { sound: 'default', 'content-available': 1 } }
      }
    });
    const stale = result.responses.flatMap((response, index) => response.success ? [] :
      ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(response.error?.code) ? [batch[index].ref] : []);
    if (stale.length) await Promise.all(stale.map(ref => ref.delete()));
  }
}

exports.notifyNewBooking = onDocumentCreated({ document: 'bookings/{bookingId}', region }, async event => {
  const booking = event.data?.data();
  if (!booking?.businessId) return;
  await notifyUser(booking.businessId, 'New MeetInc booking request', `${booking.customerName || 'A customer'} requested ${booking.offerName || 'an appointment'}.`, `booking-${event.params.bookingId}`);
});

exports.notifyNewMessage = onDocumentCreated({ document: 'bookings/{bookingId}/messages/{messageId}', region }, async event => {
  const message = event.data?.data();
  if (!message?.senderUid) return;
  const bookingSnap = await db.doc(`bookings/${event.params.bookingId}`).get();
  if (!bookingSnap.exists) return;
  const booking = bookingSnap.data();
  const recipient = message.senderUid === booking.customerUid ? booking.businessId : booking.customerUid;
  if (!recipient || recipient === message.senderUid) return;
  await notifyUser(recipient, `New message from ${message.senderName || 'your MeetInc contact'}`, 'Open MeetInc to read your message.', `message-${event.params.bookingId}`);
});

exports.notifyIncomingCall = onDocumentCreated({ document: 'bookings/{bookingId}/calls/{callId}', region }, async event => {
  const call = event.data?.data();
  if (!call || call.status !== 'ringing' || !call.calleeUid) return;
  await notifyUser(call.calleeUid, 'Incoming MeetInc voice call', `${call.callerName || 'Your MeetInc contact'} is calling. Open MeetInc to answer.`, `call-${event.params.callId}`, { type: 'call', urgent: true });
});

function feePercent() {
  const value = Number(platformFee.value());
  if (!Number.isFinite(value) || value < 0 || value > 30) {
    throw new HttpsError('failed-precondition', 'MeetInc platform fee is not configured.');
  }
  return value;
}
function feeBearer() {
  const value = feeBearerSetting.value();
  if (!['account', 'subaccount'].includes(value)) {
    throw new HttpsError('failed-precondition', 'Choose who pays Paystack processing fees: account or subaccount.');
  }
  return value;
}
function payoutSettings() {
  const bearer = feeBearer();
  return { feePercent: feePercent(), feeBearer: bearer };
}

async function paystack(path, options = {}) {
  const response = await fetch(`${paystackApi}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${paystackSecret.value()}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const result = await response.json();
  if (!response.ok || !result.status) {
    throw new HttpsError('failed-precondition', result.message || 'Payment provider request failed.');
  }
  return result.data;
}

exports.getPaystackBanks = onCall({ region, secrets: [paystackSecret] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  return (await paystack('/bank?country=south%20africa&currency=ZAR&perPage=100')).map(b => ({ name: b.name, code: b.code }));
});

exports.getPayoutStatus = onCall({ region }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const snap = await db.doc(`businessPayouts/${request.auth.uid}`).get();
  const settings = payoutSettings();
  if (!snap.exists) return { connected: false, ...settings };
  const data = snap.data();
  return { connected: true, bankName: data.bankName, accountName: data.accountName, accountLast4: data.accountLast4, ...settings };
});

exports.connectBusinessPayout = onCall({ region, secrets: [paystackSecret], memory: '256MiB' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const uid = request.auth.uid;
  const user = await db.doc(`users/${uid}`).get();
  if (!user.exists || user.data().role !== 'business') throw new HttpsError('permission-denied', 'Only business accounts can connect payouts.');
  const businessSnap = await db.doc(`businesses/${uid}`).get();
  if (!businessSnap.exists) throw new HttpsError('failed-precondition', 'Save your business profile first.');
  if (businessSnap.data().currency !== 'R') throw new HttpsError('failed-precondition', 'Online payments currently support South African rand offers only. Set your business currency to rand first.');
  const existingPayout = await db.doc(`businessPayouts/${uid}`).get();
  if (existingPayout.exists) throw new HttpsError('already-exists', 'A payout account is already connected. Contact MeetInc support to change it.');
  const { bankCode, accountNumber } = request.data || {};
  if (typeof bankCode !== 'string' || !/^[A-Za-z0-9_-]{2,20}$/.test(bankCode) || typeof accountNumber !== 'string' || !/^\d{6,20}$/.test(accountNumber)) {
    throw new HttpsError('invalid-argument', 'Enter a valid bank and account number.');
  }
  const { feePercent: fee, feeBearer: bearer } = payoutSettings();
  const biz = businessSnap.data();
  const created = await paystack('/subaccount', { method: 'POST', body: JSON.stringify({
    business_name: biz.name,
    settlement_bank: bankCode,
    account_number: accountNumber,
    percentage_charge: fee
  }) });
  await db.doc(`businessPayouts/${uid}`).set({
    subaccountCode: created.subaccount_code,
    bankName: created.settlement_bank,
    accountLast4: accountNumber.slice(-4),
    feePercent: fee,
    connectedAt: new Date()
  });
  return { connected: true, bankName: created.settlement_bank, accountLast4: accountNumber.slice(-4), feePercent: fee, feeBearer: bearer };
});

exports.createPaymentCheckout = onCall({ region, secrets: [paystackSecret], memory: '256MiB' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const bookingId = request.data?.bookingId;
  if (typeof bookingId !== 'string' || bookingId.length > 128) throw new HttpsError('invalid-argument', 'Invalid appointment.');
  const ref = db.doc(`bookings/${bookingId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Appointment not found.');
  const booking = snap.data();
  if (booking.customerUid !== request.auth.uid) throw new HttpsError('permission-denied', 'This appointment belongs to another customer.');
  if (booking.status !== 'Confirmed') throw new HttpsError('failed-precondition', 'The business must confirm your appointment before payment.');
  if (booking.paymentStatus === 'Paid') throw new HttpsError('already-exists', 'This appointment has already been paid.');
  const businessSnap = await db.doc(`businesses/${booking.businessId}`).get();
  const offerSnap = await db.doc(`businesses/${booking.businessId}/offers/${booking.offerId}`).get();
  const payout = await db.doc(`businessPayouts/${booking.businessId}`).get();
  if (!businessSnap.exists || !offerSnap.exists || !payout.exists) throw new HttpsError('failed-precondition', 'This business is not ready to accept online payments.');
  const offer = offerSnap.data();
  const amount = offer.amountCents;
  if (!Number.isInteger(amount) || amount < 100 || offer.currency !== 'ZAR') throw new HttpsError('failed-precondition', 'This offer does not have a valid online price.');
  const reference = `mi_${bookingId}_${crypto.randomBytes(5).toString('hex')}`;
  const paymentRef = db.doc(`payments/${reference}`);
  const reservation = await db.runTransaction(async tx => {
    const currentSnap = await tx.get(ref);
    if (!currentSnap.exists) throw new HttpsError('not-found', 'Appointment not found.');
    const current = currentSnap.data();
    if (current.customerUid !== request.auth.uid || current.status !== 'Confirmed') throw new HttpsError('failed-precondition', 'This appointment is not ready for payment.');
    if (current.paymentStatus === 'Paid') throw new HttpsError('already-exists', 'This appointment has already been paid.');
    if (current.paymentStatus === 'Processing' && current.paymentReference) {
      const pendingRef = db.doc(`payments/${current.paymentReference}`);
      const pendingSnap = await tx.get(pendingRef);
      if (pendingSnap.exists && pendingSnap.data().authorizationUrl) return { authorizationUrl: pendingSnap.data().authorizationUrl };
      throw new HttpsError('already-exists', 'Checkout is starting. Please wait a moment and try again.');
    }
    tx.create(paymentRef, { bookingId, businessId: booking.businessId, customerUid: request.auth.uid, amountCents: amount, currency: 'ZAR', status: 'Starting', createdAt: new Date() });
    tx.update(ref, { paymentStatus: 'Processing', paymentReference: reference, updatedAt: new Date() });
    return { start: true };
  });
  if (reservation.authorizationUrl) return { authorizationUrl: reservation.authorizationUrl };
  try {
    const data = await paystack('/transaction/initialize', { method: 'POST', body: JSON.stringify({
      email: booking.customerEmail,
      amount,
      currency: 'ZAR',
      reference,
      subaccount: payout.data().subaccountCode,
      bearer: feeBearer(),
      callback_url: 'https://meetinc-9072a.web.app/?payment=return',
      metadata: { bookingId, businessId: booking.businessId, customerUid: request.auth.uid }
    }) });
    await paymentRef.update({ status: 'Pending', authorizationUrl: data.authorization_url });
    return { authorizationUrl: data.authorization_url };
  } catch (error) {
    await db.runTransaction(async tx => {
      const currentSnap = await tx.get(ref);
      if (currentSnap.exists && currentSnap.data().paymentReference === reference) tx.update(ref, { paymentStatus: 'Unpaid', paymentReference: null, updatedAt: new Date() });
      tx.update(paymentRef, { status: 'Failed', updatedAt: new Date() });
    });
    throw error;
  }
});

exports.paystackWebhook = onRequest({ region, secrets: [paystackSecret], invoker: 'public' }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  const signature = req.get('x-paystack-signature') || '';
  const raw = req.rawBody;
  const expected = crypto.createHmac('sha512', paystackSecret.value()).update(raw).digest('hex');
  const left = Buffer.from(signature, 'hex');
  const right = Buffer.from(expected, 'hex');
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return res.status(401).send('Invalid signature');
  const event = req.body;
  if (event?.event !== 'charge.success' || !event?.data?.reference) return res.status(200).send('Ignored');
  try {
    const ref = String(event.data.reference);
    const paymentRef = db.doc(`payments/${ref}`);
    const paymentSnap = await paymentRef.get();
    if (!paymentSnap.exists) return res.status(200).send('Unknown reference');
    const payment = paymentSnap.data();
    const verified = await paystack(`/transaction/verify/${encodeURIComponent(ref)}`);
    if (verified.status !== 'success' || verified.reference !== ref || verified.amount !== payment.amountCents || verified.currency !== 'ZAR') return res.status(400).send('Payment verification mismatch');
    const bookingRef = db.doc(`bookings/${payment.bookingId}`);
    await db.runTransaction(async tx => {
      const current = await tx.get(paymentRef);
      if (current.data()?.status === 'Paid') return;
      tx.update(paymentRef, { status: 'Paid', paidAt: new Date(), providerReference: ref });
      tx.update(bookingRef, { paymentStatus: 'Paid', paymentReference: ref, updatedAt: new Date() });
    });
    return res.status(200).send('Processed');
  } catch (error) {
    console.error('Paystack webhook processing failed', error);
    return res.status(500).send('Retry later');
  }
});
