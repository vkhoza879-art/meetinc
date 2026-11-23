// Register the click handler before Firebase Messaging so it can preserve the
// MeetInc destination for background notifications.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  if (target.origin !== self.location.origin) target.href = self.location.origin + '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      existing.navigate(target.href);
      return existing.focus();
    }
    return self.clients.openWindow(target.href);
  }));
});

importScripts('https://www.gstatic.com/firebasejs/13.4.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/13.4.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBbjUyJf2DHoW4Zk7lCzlLwitMz_VHieYE',
  authDomain: 'meetinc-9072a.firebaseapp.com',
  projectId: 'meetinc-9072a',
  storageBucket: 'meetinc-9072a.firebasestorage.app',
  messagingSenderId: '802867466895',
  appId: '1:802867466895:web:8d7decca0e5b16296656fa'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  // Notification messages are displayed automatically by FCM in the background.
  if (payload.notification) return;
  const data = payload.data || {};
  const title = data.title || 'MeetInc update';
  return self.registration.showNotification(title, {
    body: data.body || 'Open MeetInc to see what is new.',
    tag: data.tag || 'meetinc-update',
    data: { url: data.url || self.location.origin + '/' }
  });
});
