import { FirebaseMessaging, Importance } from '@capacitor-firebase/messaging';

let actionListenerInstalled = false;
let tokenListenerInstalled = false;
let notificationListenerInstalled = false;

export async function registerNativePush(requestPermission = false) {
  if (window.Capacitor?.getPlatform?.() === 'android') {
    await Promise.all([
      FirebaseMessaging.createChannel({ id: 'meetinc_updates', name: 'MeetInc updates', description: 'Appointment and chat updates', importance: Importance.Default, vibration: true }),
      FirebaseMessaging.createChannel({ id: 'meetinc_calls', name: 'MeetInc calls', description: 'Incoming MeetInc voice calls', importance: Importance.Max, vibration: true })
    ]);
  }
  let permissions = await FirebaseMessaging.checkPermissions();
  if (permissions.receive !== 'granted' && requestPermission) {
    permissions = await FirebaseMessaging.requestPermissions();
  }
  if (permissions.receive !== 'granted') {
    throw new Error('Allow notifications in your device settings to receive MeetInc alerts.');
  }

  if (!actionListenerInstalled) {
    await FirebaseMessaging.addListener('notificationActionPerformed', event => {
      window.dispatchEvent(new CustomEvent('meetinc-notification-action', { detail: event.notification?.data || {} }));
    });
    actionListenerInstalled = true;
  }
  if (!tokenListenerInstalled) {
    await FirebaseMessaging.addListener('tokenReceived', event => {
      window.dispatchEvent(new CustomEvent('meetinc-native-fcm-token', { detail: event.token }));
    });
    tokenListenerInstalled = true;
  }
  if (!notificationListenerInstalled) {
    await FirebaseMessaging.addListener('notificationReceived', event => {
      window.dispatchEvent(new CustomEvent('meetinc-native-notification', { detail: event.notification || {} }));
    });
    notificationListenerInstalled = true;
  }
  const result = await FirebaseMessaging.getToken();
  if (!result.token) throw new Error('MeetInc did not receive an FCM token. Check the Firebase mobile app setup.');
  return result.token;
}
