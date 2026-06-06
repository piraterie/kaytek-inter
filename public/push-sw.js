// Push notification handlers — classic SW script (importé par le SW principal)

self.addEventListener('push', function (event) {
  if (!event.data) return;

  var data = {};
  try { data = event.data.json(); } catch (e) { data = { body: event.data.text() }; }

  var title = data.title || 'Kaytek Inter';
  var options = {
    body: data.body || 'Nouvelle notification',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'kaytek-' + (data.url || 'notif').replace(/\//g, '-'),
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' }
  };

  console.log('[push-sw] push reçu — title:', title, '| url:', data.url);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var targetPath = (event.notification.data && event.notification.data.url) || '/';
  var fullUrl = self.location.origin + targetPath;

  console.log('[push-sw] notificationclick — targetPath:', targetPath, '| fullUrl:', fullUrl);

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      // App déjà ouverte : postMessage pour navigation React Router sans reload
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.startsWith(self.location.origin)) {
          console.log('[push-sw] app ouverte — postMessage NAVIGATE:', targetPath);
          c.postMessage({ type: 'NAVIGATE', url: targetPath });
          return c.focus();
        }
      }
      // App fermée : ouvrir avec marqueur push_open pour activer la session
      var openUrl = fullUrl + (fullUrl.indexOf('?') >= 0 ? '&' : '?') + 'push_open=1';
      console.log('[push-sw] app fermée — openWindow:', openUrl);
      return clients.openWindow(openUrl);
    })
  );
});
