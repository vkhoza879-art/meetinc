const crypto = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
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

exports.notifyBookingUpdates = onDocumentUpdated({ document: 'bookings/{bookingId}', region }, async event => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  const statusChanged = before.status !== after.status;
  const rescheduleChanged = JSON.stringify(before.rescheduleRequest || null) !== JSON.stringify(after.rescheduleRequest || null);
  if (!statusChanged && !rescheduleChanged) return;
  const actor = after.updatedBy || '';
  const recipient = actor === after.businessId ? after.customerUid : after.businessId;
  if (!recipient || recipient === actor) return;
  const action = after.lastBookingAction || '';
  const isProposal = action === 'requestReschedule';
  const title = isProposal ? 'New time proposal for your appointment'
    : action === 'acceptReschedule' ? 'Appointment time changed'
      : action === 'declineReschedule' ? 'Time proposal declined'
        : `Appointment ${String(after.status || 'updated').toLowerCase()}`;
  const body = isProposal
    ? `${actor === after.customerUid ? after.customerName || 'Your customer' : after.businessName || 'The business'} proposed ${after.rescheduleRequest?.date || ''} at ${after.rescheduleRequest?.time || ''}.`
    : action === 'declineReschedule' ? 'The proposed appointment time was declined.'
      : action === 'acceptReschedule' ? `The appointment is now set for ${after.confirmedDate} at ${after.confirmedTime}.`
        : `${after.offerName || 'Your appointment'} with ${after.businessName || 'MeetInc'} is now ${String(after.status || 'updated').toLowerCase()}.`;
  await notifyUser(recipient, title, body, `booking-update-${event.params.bookingId}`);
});

function parseDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? null : parsed;
}

function localSouthAfricaNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${value.year}-${value.month}-${value.day}`, minutes: Number(value.hour) * 60 + Number(value.minute) };
}

function validateBookingHorizon(date, today) {
  const todayDate = parseDate(today.date);
  const daysAhead = (date.getTime() - todayDate.getTime()) / 86400000;
  if (daysAhead > 366) throw new HttpsError('failed-precondition', 'Appointments can be booked up to one year ahead.');
}

function timeMinutes(time) {
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return -1;
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function bookingSlotRef(businessId, date, time) {
  const id = crypto.createHash('sha256').update(`${businessId}|${date}|${time}`).digest('hex');
  return db.doc(`bookingSlots/${id}`);
}

function validateBusinessSlot(business, date, time) {
  const parsed = parseDate(date);
  const start = timeMinutes(time);
  if (!parsed || start < 0) throw new HttpsError('invalid-argument', 'Choose a valid appointment date and time.');
  const today = localSouthAfricaNow();
  validateBookingHorizon(parsed, today);
  if (date < today.date || (date === today.date && start <= today.minutes)) {
    throw new HttpsError('failed-precondition', 'Choose an appointment time in the future.');
  }
  const days = Array.isArray(business.workingDays) ? business.workingDays : [];
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parsed.getUTCDay()];
  const opening = timeMinutes(business.openTime || '09:00');
  const closing = timeMinutes(business.closeTime || '17:00');
  const duration = Number(business.meetingMinutes) || 30;
  const interval = Number(business.slotMinutes) || 30;
  if (!days.includes(day) || opening < 0 || closing <= opening || ![15, 30, 60].includes(interval) || ![30, 45, 60, 90, 120].includes(duration)) {
    throw new HttpsError('failed-precondition', 'The business is not accepting appointments for that day.');
  }
  if (start < opening || start + duration > closing || (start - opening) % interval !== 0) {
    throw new HttpsError('failed-precondition', 'That time is outside the business appointment schedule.');
  }
  return { date, time, minutes: start };
}

function slotsForBusinessDate(business, date) {
  const parsed = parseDate(date);
  if (!parsed) throw new HttpsError('invalid-argument', 'Choose a valid date.');
  validateBookingHorizon(parsed, localSouthAfricaNow());
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parsed.getUTCDay()];
  if (!(business.workingDays || []).includes(day)) return [];
  const opening = timeMinutes(business.openTime || '09:00');
  const closing = timeMinutes(business.closeTime || '17:00');
  const duration = Number(business.meetingMinutes) || 30;
  const interval = Number(business.slotMinutes) || 30;
  const now = localSouthAfricaNow();
  const slots = [];
  for (let minute = opening; minute >= 0 && minute + duration <= closing; minute += interval) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    if (date > now.date || (date === now.date && minute > now.minutes)) slots.push(time);
  }
  return slots;
}

exports.getAvailableBookingSlots = onCall({ region }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to view appointment times.');
  const { businessId, date } = request.data || {};
  if (typeof businessId !== 'string' || businessId.length > 128 || businessId.includes('/')) throw new HttpsError('invalid-argument', 'Choose a business.');
  const businessSnap = await db.doc(`businesses/${businessId}`).get();
  if (!businessSnap.exists) throw new HttpsError('not-found', 'Business not found.');
  const business = businessSnap.data();
  const slots = slotsForBusinessDate(business, date);
  if (!slots.length) return { slots: [] };
  const refs = slots.map(time => bookingSlotRef(businessId, date, time));
  const [locks, legacy] = await Promise.all([
    db.getAll(...refs),
    db.collection('bookings').where('businessId', '==', businessId).where('preferredDate', '==', date).get()
  ]);
  const occupied = new Set(legacy.docs.filter(doc => ['Pending', 'Confirmed'].includes(doc.data().status)).map(doc => doc.data().preferredTime));
  return { slots: slots.filter((time, index) => !occupied.has(time) && (!locks[index].exists || locks[index].data()?.expiresAt?.toDate?.() <= new Date())) };
});

exports.createBooking = onCall({ region }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to request an appointment.');
  const input = request.data || {};
  const businessId = typeof input.businessId === 'string' ? input.businessId : '';
  if (!businessId || businessId.length > 128 || businessId.includes('/')) throw new HttpsError('invalid-argument', 'Choose a business.');
  const uid = request.auth.uid;
  const businessRef = db.doc(`businesses/${businessId}`);
  const userRef = db.doc(`users/${uid}`);
  const offerId = typeof input.offerId === 'string' ? input.offerId : 'general';
  if (!offerId || offerId.length > 128 || offerId.includes('/')) throw new HttpsError('invalid-argument', 'Choose a valid service.');
  const offerRef = offerId === 'general' ? null : db.doc(`businesses/${businessId}/offers/${offerId}`);
  const bookingRef = db.collection('bookings').doc();
  const date = input.preferredDate;
  const time = input.preferredTime;
  if (!parseDate(date) || timeMinutes(time) < 0) throw new HttpsError('invalid-argument', 'Choose a valid appointment date and time.');
  const slotRef = bookingSlotRef(businessId, date, time);
  const legacyBookingsQuery = db.collection('bookings').where('businessId', '==', businessId).where('preferredDate', '==', date);
  const now = new Date();
  const created = await db.runTransaction(async tx => {
    const [businessSnap, userSnap, slotSnap, legacyBookings] = await Promise.all([tx.get(businessRef), tx.get(userRef), tx.get(slotRef), tx.get(legacyBookingsQuery)]);
    if (!businessSnap.exists) throw new HttpsError('not-found', 'Business not found.');
    if (!userSnap.exists || userSnap.data().role !== 'customer') throw new HttpsError('permission-denied', 'Only customer accounts can request appointments.');
    const business = businessSnap.data();
    const user = userSnap.data();
    validateBusinessSlot(business, date, time);
    if (slotSnap.exists && !(slotSnap.data()?.expiresAt?.toDate?.() <= now)) {
      throw new HttpsError('already-exists', 'That appointment time has just been booked. Choose another available time.');
    }
    if (legacyBookings.docs.some(doc => ['Pending', 'Confirmed'].includes(doc.data().status) && doc.data().preferredTime === time)) {
      throw new HttpsError('already-exists', 'That appointment time has just been booked. Choose another available time.');
    }
    let offer = null;
    if (offerRef) {
      const offerSnap = await tx.get(offerRef);
      if (!offerSnap.exists || offerSnap.data().ownerUid !== businessId) throw new HttpsError('not-found', 'That service is no longer available.');
      offer = offerSnap.data();
    }
    const orderDetail = String(input.orderDetail || '').trim().slice(0, 700);
    const assistance = String(input.assistance || '').trim().slice(0, 100);
    const backupDate = String(input.backupDate || '').trim();
    const backupTime = String(input.backupTime || business.backupTime || '14:00');
    if (!assistance) throw new HttpsError('invalid-argument', 'Choose the assistance you need.');
    const backupParsed = parseDate(backupDate);
    const backupMinute = timeMinutes(backupTime);
    const nowLocal = localSouthAfricaNow();
    if (backupParsed) validateBookingHorizon(backupParsed, nowLocal);
    if (!backupParsed || backupMinute < 0 || backupDate < nowLocal.date || (backupDate === nowLocal.date && backupMinute <= nowLocal.minutes)) {
      throw new HttpsError('invalid-argument', 'Choose a future backup date and time.');
    }
    const backupDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][backupParsed.getUTCDay()];
    const openMinute = timeMinutes(business.openTime || '09:00');
    const closeMinute = timeMinutes(business.closeTime || '17:00');
    if (!(business.workingDays || []).includes(backupDay) || backupMinute < openMinute || backupMinute + (Number(business.meetingMinutes) || 30) > closeMinute) {
      throw new HttpsError('failed-precondition', 'Choose a backup time during the business’s working hours.');
    }
    const booking = {
      businessId, businessName: business.name || 'Business', businessAvatarData: business.photoData || '', businessAvatarPreset: business.avatarPreset || 'fern',
      category: business.category || '', customerUid: uid, customerName: user.name || request.auth.token.name || 'Customer',
      customerEmail: request.auth.token.email || '', customerAvatarData: user.avatarData || '', customerAvatarPreset: user.avatarPreset || 'fern',
      customerPhone: String(input.customerPhone || '').trim().slice(0, 40), offerId, offerName: offer?.name || 'General enquiry',
      amountCents: Number.isInteger(offer?.amountCents) ? offer.amountCents : 0, currency: offer?.currency || business.currency || 'ZAR',
      paymentStatus: offer?.amountCents > 0 ? 'Unpaid' : 'NotRequired', orderDetail, assistance,
      preferredDate: date, preferredTime: time, backupDate, backupTime,
      alternateTime: String(input.alternateTime || '').trim().slice(0, 120), note: String(input.note || '').trim().slice(0, 700),
      status: 'Pending', confirmedDate: '', confirmedTime: '', slotKey: slotRef.id, lastBookingAction: 'requested',
      createdAt: now, updatedAt: now, updatedBy: uid
    };
    tx.create(bookingRef, booking);
    if (slotSnap.exists) tx.set(slotRef, { businessId, date, time, bookingId: bookingRef.id, status: 'Pending', createdAt: now, expiresAt: null });
    else tx.create(slotRef, { businessId, date, time, bookingId: bookingRef.id, status: 'Pending', createdAt: now, expiresAt: null });
    tx.create(bookingRef.collection('events').doc(), { type: 'requested', actorUid: uid, actorName: booking.customerName, date, time, createdAt: now });
    return bookingRef.id;
  });
  return { bookingId: created };
});

exports.manageBooking = onCall({ region }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to manage appointments.');
  const { bookingId, action } = request.data || {};
  if (typeof bookingId !== 'string' || bookingId.length > 128 || bookingId.includes('/')) throw new HttpsError('invalid-argument', 'Invalid appointment.');
  const uid = request.auth.uid;
  const bookingRef = db.doc(`bookings/${bookingId}`);
  const eventRef = bookingRef.collection('events').doc();
  await db.runTransaction(async tx => {
    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists) throw new HttpsError('not-found', 'Appointment not found.');
    const booking = bookingSnap.data();
    const isBusiness = booking.businessId === uid;
    const isCustomer = booking.customerUid === uid;
    if (!isBusiness && !isCustomer) throw new HttpsError('permission-denied', 'This appointment belongs to someone else.');
    let currentSlotRef = booking.slotKey ? db.doc(`bookingSlots/${booking.slotKey}`) : bookingSlotRef(booking.businessId, booking.preferredDate, booking.preferredTime);
    let currentSlotSnap = null;
    let targetSlotRef = null;
    let targetSlotSnap = null;
    let business = null;
    let next = { updatedAt: new Date(), updatedBy: uid, lastBookingAction: action };
    let event = { type: action, actorUid: uid, actorName: request.auth.token.name || (isBusiness ? 'Business' : 'Customer'), createdAt: new Date() };

    if (action === 'confirm' || action === 'decline' || action === 'cancel') {
      if (action === 'confirm' && (!isBusiness || booking.status !== 'Pending')) throw new HttpsError('failed-precondition', 'Only the business can confirm a pending appointment.');
      if (action === 'decline' && (!isBusiness || booking.status !== 'Pending')) throw new HttpsError('failed-precondition', 'Only the business can decline a pending appointment.');
      if (action === 'cancel' && !['Pending', 'Confirmed'].includes(booking.status)) throw new HttpsError('failed-precondition', 'This appointment can no longer be cancelled.');
      if (action === 'cancel' && booking.paymentStatus === 'Paid') throw new HttpsError('failed-precondition', 'This paid appointment needs to be handled by the business.');
      currentSlotSnap = await tx.get(currentSlotRef);
      if (action === 'confirm') {
        if (currentSlotSnap.exists && currentSlotSnap.data()?.bookingId !== bookingId) throw new HttpsError('failed-precondition', 'The reserved time is no longer available.');
        if (!currentSlotSnap.exists) tx.create(currentSlotRef, { businessId: booking.businessId, date: booking.preferredDate, time: booking.preferredTime, bookingId, status: 'Confirmed', createdAt: new Date(), expiresAt: null });
        next.status = 'Confirmed'; next.confirmedDate = booking.preferredDate; next.confirmedTime = booking.preferredTime;
        event.date = booking.preferredDate; event.time = booking.preferredTime;
      } else if (action === 'decline' || action === 'cancel') {
        let pendingSlotRef = null;
        let pendingSlotSnap = null;
        if (booking.rescheduleRequest?.slotKey) {
          pendingSlotRef = db.doc(`bookingSlots/${booking.rescheduleRequest.slotKey}`);
          pendingSlotSnap = await tx.get(pendingSlotRef);
        }
        if (currentSlotSnap.exists && currentSlotSnap.data()?.bookingId === bookingId) tx.delete(currentSlotRef);
        if (pendingSlotSnap?.exists && pendingSlotSnap.data()?.bookingId === bookingId) tx.delete(pendingSlotRef);
        next.status = action === 'decline' ? 'Declined' : 'Cancelled';
        next.confirmedDate = ''; next.confirmedTime = '';
        next.rescheduleRequest = null;
        if (action === 'cancel') next.cancelledBy = uid;
      }
    } else if (action === 'requestReschedule') {
      if (booking.rescheduleRequest) throw new HttpsError('failed-precondition', 'A time change is already waiting for a response.');
      if (!['Pending', 'Confirmed'].includes(booking.status)) throw new HttpsError('failed-precondition', 'Only upcoming appointments can be rescheduled.');
      const date = request.data?.date; const time = request.data?.time;
      if (date === booking.preferredDate && time === booking.preferredTime) throw new HttpsError('invalid-argument', 'Choose a different appointment time.');
      const businessSnap = await tx.get(db.doc(`businesses/${booking.businessId}`));
      if (!businessSnap.exists) throw new HttpsError('not-found', 'Business not found.');
      business = businessSnap.data(); validateBusinessSlot(business, date, time);
      targetSlotRef = bookingSlotRef(booking.businessId, date, time);
      const legacyTargetQuery = db.collection('bookings').where('businessId', '==', booking.businessId).where('preferredDate', '==', date);
      const [targetRead, currentRead, legacyTargetRead] = await Promise.all([tx.get(targetSlotRef), tx.get(currentSlotRef), tx.get(legacyTargetQuery)]);
      targetSlotSnap = targetRead; currentSlotSnap = currentRead;
      if (targetSlotSnap.exists && !(targetSlotSnap.data()?.expiresAt?.toDate?.() <= new Date())) throw new HttpsError('already-exists', 'That time has just been taken. Choose another.');
      if (legacyTargetRead.docs.some(doc => doc.id !== bookingId && ['Pending', 'Confirmed'].includes(doc.data().status) && doc.data().preferredTime === time)) {
        throw new HttpsError('already-exists', 'That time has just been taken. Choose another.');
      }
      if (currentSlotSnap.exists && currentSlotSnap.data()?.bookingId !== bookingId) throw new HttpsError('failed-precondition', 'Your current appointment time is now occupied. Please contact the business.');
      if (!currentSlotSnap.exists) tx.create(currentSlotRef, { businessId: booking.businessId, date: booking.preferredDate, time: booking.preferredTime, bookingId, status: booking.status, createdAt: new Date(), expiresAt: null });
      tx.set(targetSlotRef, { businessId: booking.businessId, date, time, bookingId, status: 'RescheduleRequested', createdAt: new Date(), expiresAt: null });
      next.rescheduleRequest = { date, time, slotKey: targetSlotRef.id, requestedBy: uid, requestedAt: new Date() };
      event.date = date; event.time = time;
    } else if (action === 'acceptReschedule' || action === 'declineReschedule') {
      if (!booking.rescheduleRequest || booking.rescheduleRequest.requestedBy === uid) throw new HttpsError('failed-precondition', 'There is no time proposal waiting for your response.');
      targetSlotRef = db.doc(`bookingSlots/${booking.rescheduleRequest.slotKey}`);
      [targetSlotSnap, currentSlotSnap] = await Promise.all([tx.get(targetSlotRef), tx.get(currentSlotRef)]);
      if (!targetSlotSnap.exists || targetSlotSnap.data()?.bookingId !== bookingId) throw new HttpsError('failed-precondition', 'That proposed time is no longer reserved.');
      if (action === 'acceptReschedule') {
        if (currentSlotSnap.exists && currentSlotSnap.data()?.bookingId === bookingId) tx.delete(currentSlotRef);
        tx.update(targetSlotRef, { status: 'Confirmed', createdAt: new Date() });
        const proposal = booking.rescheduleRequest;
        next.preferredDate = proposal.date; next.preferredTime = proposal.time;
        next.confirmedDate = proposal.date; next.confirmedTime = proposal.time; next.status = 'Confirmed';
        next.slotKey = targetSlotRef.id;
        event.date = proposal.date; event.time = proposal.time;
      } else {
        tx.delete(targetSlotRef);
      }
      next.rescheduleRequest = null;
    } else {
      throw new HttpsError('invalid-argument', 'Unsupported appointment action.');
    }
    tx.update(bookingRef, next);
    tx.create(eventRef, event);
  });
  return { updated: true };
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
