import type { Settings } from './settings';

interface Props {
  settings: Settings;
  onClose: () => void;
  onChange: (settings: Settings) => void;
}

export default function SettingsPanel({ settings, onClose, onChange }: Props) {
  return (
    <div className="settings-backdrop" onMouseDown={onClose}>
      <div className="settings-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="settings-body">
          <div className="setting">
            <label htmlFor="fontSize">Font Size</label>
            <div className="setting-control">
              <input
                id="fontSize"
                type="range"
                min="11"
                max="18"
                value={settings.fontSize}
                onChange={(e) =>
                  onChange({ ...settings, fontSize: Number(e.target.value) })
                }
              />
              <span className="value">{settings.fontSize}px</span>
            </div>
          </div>

          <div className="setting">
            <label htmlFor="tabWidth">Tab Width</label>
            <div className="setting-control">
              <select
                id="tabWidth"
                value={settings.tabWidth}
                onChange={(e) =>
                  onChange({ ...settings, tabWidth: Number(e.target.value) })
                }
              >
                <option value="2">2 spaces</option>
                <option value="4">4 spaces</option>
                <option value="8">8 spaces</option>
              </select>
            </div>
          </div>

          <div className="setting">
            <label htmlFor="theme">Theme</label>
            <div className="setting-control">
              <select
                id="theme"
                value={settings.theme}
                onChange={(e) =>
                  onChange({ ...settings, theme: e.target.value as 'dark' | 'light' })
                }
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
