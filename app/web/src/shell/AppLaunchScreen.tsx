import React from 'react';
import type {RegistryAuthState} from '../registry/RegistryAuthController';

export type AppLaunchSurface = 'launch' | 'connect-retry' | 'login';

// While the registry session is being checked (or an existing session is
// auto-connecting) the user should watch the brand launch screen, never the
// login form; the form is reserved for the genuinely unauthenticated case.
// A failed auto-connect falls back to a manual Connect button.
export function resolveAppLaunchSurface(
  authState: RegistryAuthState,
  hasConnectError: boolean,
): AppLaunchSurface {
  switch (authState) {
    case 'checking':
    case 'logging-in':
      return 'launch';
    case 'authenticated':
      return hasConnectError ? 'connect-retry' : 'launch';
    default:
      return 'login';
  }
}

export function appLaunchStatus(authState: RegistryAuthState): string {
  if (authState === 'checking') return 'Checking login…';
  if (authState === 'logging-in') return 'Logging in…';
  return 'Connecting…';
}

// Logo geometry mirrored from public/icons/icon-mark.svg (viewBox 160 292 927
// 600): a blue "<", a white "/", and an orange ">" reading as a code glyph.
const LOGO_PATH_BLUE =
  'M427 822 L362 822 L197.3 633.2 Q170 593 196.9 550.3 L383 334 Q400 316 429 316 L554 316 Q570 316 564 344 L355 593 L461 714 L370 822 Z';
const LOGO_PATH_ORANGE =
  'M820 362 L885 362 L1049.7 550.8 Q1077 591 1050.1 633.7 L864 850 Q847 868 818 868 L693 868 Q677 868 683 840 L892 591 L786 470 L877 362 Z';
const LOGO_PATH_SLASH = 'M809 316 L923 316 L688 580 L436 868 L326 868 Z';

function AppLaunchLogo() {
  return (
    <svg
      className="app-launch-logo"
      viewBox="160 292 927 600"
      width={96}
      height={62}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wm-launch-gBlue" x1="557" y1="319" x2="197" y2="714" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1380f1" />
          <stop offset="0.15" stopColor="#1c94f8" />
          <stop offset="0.33" stopColor="#1eb0fa" />
          <stop offset="0.5" stopColor="#23cffb" />
          <stop offset="0.65" stopColor="#2deafc" />
          <stop offset="0.85" stopColor="#32f0fd" />
          <stop offset="1" stopColor="#36f2fd" />
        </linearGradient>
        <linearGradient id="wm-launch-gOrange" x1="690" y1="865" x2="1000" y2="470" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fb6402" />
          <stop offset="0.15" stopColor="#fc7802" />
          <stop offset="0.33" stopColor="#fd9c02" />
          <stop offset="0.5" stopColor="#fda801" />
          <stop offset="0.65" stopColor="#fdc001" />
          <stop offset="0.85" stopColor="#fdc801" />
          <stop offset="1" stopColor="#fed608" />
        </linearGradient>
        <linearGradient id="wm-launch-gWhite" x1="850" y1="320" x2="380" y2="860" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f3fafe" />
          <stop offset="0.38" stopColor="#dbf0fc" />
          <stop offset="1" stopColor="#f0f9fe" />
        </linearGradient>
        <linearGradient id="wm-launch-shineGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <mask id="wm-launch-mask" maskUnits="userSpaceOnUse" x="100" y="240" width="1080" height="720">
          <path d={LOGO_PATH_BLUE} fill="#ffffff" />
          <path d={LOGO_PATH_ORANGE} fill="#ffffff" />
          <path d={LOGO_PATH_SLASH} fill="#ffffff" />
        </mask>
      </defs>
      <g className="app-launch-piece app-launch-piece-left">
        <path d={LOGO_PATH_BLUE} fill="url(#wm-launch-gBlue)" />
      </g>
      <g className="app-launch-piece app-launch-piece-right">
        <path d={LOGO_PATH_ORANGE} fill="url(#wm-launch-gOrange)" />
      </g>
      <g className="app-launch-piece app-launch-piece-slash">
        <path d={LOGO_PATH_SLASH} fill="url(#wm-launch-gWhite)" />
      </g>
      <g mask="url(#wm-launch-mask)">
        <g className="app-launch-shine">
          <rect
            x="513"
            y="42"
            width="220"
            height="1100"
            fill="url(#wm-launch-shineGrad)"
            transform="rotate(47.2 623 592)"
          />
        </g>
      </g>
    </svg>
  );
}

export type AppLaunchScreenProps = {
  status: string;
  /** The Android host already shows the assembled logo on its native splash,
     so there the pieces skip the fly-in intro and only the shine sweep runs. */
  showIntro: boolean;
};

export function AppLaunchScreen({status, showIntro}: AppLaunchScreenProps) {
  return (
    <div
      className={`app-launch-screen${showIntro ? ' app-launch-intro' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="app-launch-body">
        <div className="app-launch-mark">
          <div className="app-launch-glow" aria-hidden="true" />
          <AppLaunchLogo />
        </div>
        <div className="app-launch-status">{status}</div>
      </div>
    </div>
  );
}
