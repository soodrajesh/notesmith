import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, saveSettings, type Settings } from '../settings';

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);

  const updateSettings = useCallback(async (next: Settings) => {
    setSettings(next);
    await saveSettings(next);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  // Set via the CSSOM rather than an injected <style> so the page doesn't depend on an inline-style CSP allowance for it.
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--editor-font-size', `${settings.fontSize}px`);
    root.setProperty('--tab-width', String(settings.tabWidth));
  }, [settings.fontSize, settings.tabWidth]);

  return { settings, setSettings, updateSettings, showSettings, setShowSettings };
}
