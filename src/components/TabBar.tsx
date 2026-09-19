import type { Tab } from '../types';

interface Props {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export default function TabBar({ tabs, activeId, onSelect, onClose }: Props) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <div key={tab.id} className={`tab${tab.id === activeId ? ' active' : ''}`}>
          <button className="tab-label" onClick={() => onSelect(tab.id)} title={tab.path ?? tab.name}>
            {tab.dirty && <span className="dot" />}
            {tab.name}
          </button>
          <button className="tab-close" onClick={() => onClose(tab.id)} title="Close" aria-label={`Close ${tab.name || 'Untitled'}`}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
