import { db } from './db';

export interface Settings {
  fontSize: number;
  tabWidth: number;
  theme: 'dark' | 'light';
}

export const DEFAULT_SETTINGS: Settings = {
  fontSize: 13,
  tabWidth: 2,
  theme: 'dark',
};

export async function loadSettings(): Promise<Settings> {
  const stored = await db.settings.get('appSettings');
  return stored?.value ? { ...DEFAULT_SETTINGS, ...stored.value } : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await db.settings.put({ key: 'appSettings', value: settings });
}
