// Push notification handlers — importé par le SW principal via importScripts

self.addEventListener('push', function (event) {
  var data = {};

  // Chrome exige que push event appelle event.waitUntil(showNotification(...)).
  // Ne jamais retourner sans le faire : Chrome pénalise le SW.
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { body: event.data.text() };
    }
  }

  var title          = data.title          || 'Kaytek Inter';
  var body           = data.body           || 'Nouvelle notification';
  var url            = data.url            || '/';
  var notificationId = data.notificationId || (Date.now() + '-' + Math.random().toString(36).slice(2, 7));
  var timestamp      = data.timestamp      || Date.now();

  // Notification critique = nouvelle intervention ou path /interventions
  var isCritical = !!(
    data.critical ||
    title.toLowerCase().includes('intervention') ||
    (url && url.includes('/interventions'))
  );

  // Tag basé sur notificationId : chaque notification est indépendante.
  // Android ne peut pas écraser une notification par une autre avec un tag différent.
  var tag = 'kaytek-' + notificationId;

  var options = {
    body:               body,
    icon:               '/icons/icon-192.png',
    badge:              '/icons/icon-192.png',
    tag:                tag,
    // renotify: true — demande à Android de rejouer son/vibration même si
    // une notification précédente est encore visible dans le tiroir.
    renotify:           isCritical,
    // requireInteraction: true — la notification reste visible jusqu'à
    // interaction explicite (ne disparaît pas automatiquement sur Android).
    requireInteraction: isCritical,
    // Vibration renforcée pour les interventions critiques.
    vibrate:            isCritical ? [300, 100, 300, 100, 300] : [200, 100, 200],
    silent:             false,
    timestamp:          timestamp,
    data:               { url: url, notificationId: notificationId },
  };

  // Bouton d'action rapide pour les interventions critiques
  if (isCritical) {
    options.actions = [
      { action: 'open', title: 'Voir l\'intervention' }
    ];
  }

  console.log('[push-sw] push reçu — title:', title, '| critical:', isCritical, '| tag:', tag);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  var action     = event.action;
  var targetPath = (event.notification.data && event.notification.data.url) || '/';
  var fullUrl    = self.location.origin + targetPath;

  console.log('[push-sw] notificationclick — action:', action, '| targetPath:', targetPath);

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      // App déjà ouverte → postMessage NAVIGATE pour navigation React Router sans reload
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.startsWith(self.location.origin)) {
          console.log('[push-sw] app ouverte — NAVIGATE:', targetPath);
          c.postMessage({ type: 'NAVIGATE', url: targetPath });
          return c.focus();
        }
      }
      // App fermée → ouvrir avec marqueur push_open pour activer la session
      var openUrl = fullUrl + (fullUrl.indexOf('?') >= 0 ? '&' : '?') + 'push_open=1';
      console.log('[push-sw] app fermée — openWindow:', openUrl);
      return clients.openWindow(openUrl);
    })
  );
});
