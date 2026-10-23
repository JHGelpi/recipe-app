import type { FeedbackDetails, UnitSystem } from '@recipe-app/domain';
import type { Appearance } from '../theme/appearance';

const APPEARANCE: Record<Appearance, FeedbackDetails['appearance']> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};
const UNITS: Record<UnitSystem, FeedbackDetails['units']> = {
  as_written: 'As written',
  us: 'US',
  metric: 'Metric',
};

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10-23 14:05 (America/New_York, UTC−04:00)": the device's own clock and zone. */
export function sentAt(now: Date, timeZone: string | undefined): string {
  const offset = -now.getTimezoneOffset();
  const sign = offset < 0 ? '−' : '+';
  const zone = `UTC${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `${date} ${time} (${timeZone ? `${timeZone}, ` : ''}${zone})`;
}

export type DeviceFacts = {
  buildTime: string;
  storage: string;
  userAgent: string;
  standalone: boolean;
  screen: { width: number; height: number };
  appearance: Appearance;
  units: UnitSystem;
  online: boolean;
  now: Date;
  timeZone: string | undefined;
};

/**
 * What a report says about the device (FR-45). Built only from these facts:
 * no account, household or recipe data is ever read here.
 */
export function feedbackDetails(
  facts: DeviceFacts,
  problem: { offlineRecently: boolean; waitingUploads: number } | null,
): FeedbackDetails {
  return {
    build: facts.buildTime.slice(0, 100),
    storage: facts.storage.slice(0, 60),
    userAgent: facts.userAgent.slice(0, 400),
    display: facts.standalone ? 'Installed app' : 'Browser tab',
    screen: `${Math.round(facts.screen.width)} × ${Math.round(facts.screen.height)}`,
    appearance: APPEARANCE[facts.appearance],
    units: UNITS[facts.units],
    online: facts.online,
    sentAt: sentAt(facts.now, facts.timeZone),
    ...(problem ?? {}),
  };
}

/** Installed to the home screen, on iOS or anywhere that reports display-mode. */
export function runsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios || (window.matchMedia?.('(display-mode: standalone)').matches ?? false);
}
