// El mini Bip que vive fuera de la app: en la Isla Dinámica (iPhone 14 Pro, 15, 16...) y en la
// pantalla de bloqueo. Es una "Actividad en directo" de iOS. La genera @bacons/apple-targets.
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'widget',
  name: 'BipIsla',
  displayName: 'Mini Bip',
  bundleIdentifier: '.isla',
  deploymentTarget: '16.4',
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit'],
  colors: {
    $widgetBackground: '#000000',
    $accent: '#4FE3C1',
  },
};
