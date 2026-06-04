declare global {
  interface Window {
    __WHEELMAKER_PWA__?: import('../platform/pwa').PWAFoundation;
  }
}

export {};
