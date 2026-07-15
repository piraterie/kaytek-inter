import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kaytekinter.app',
  appName: 'Kaytek Inter',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#2563eb',
      showSpinner: false,
    },
    StatusBar: {
      style: 'Light',
      backgroundColor: '#2563eb',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    }
  }
};

export default config;
