import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import type { SatelliteData } from '../../types';

interface SearchBarProps {
  allSats: SatelliteData[];
  onSelectSatellite: (sat: SatelliteData) => void;
}

export default function SearchBar({ allSats, onSelectSatellite }: SearchBarProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const searchResults = useMemo(() => {
    if (searchQuery.trim().length <= 1) return [];
    const q = searchQuery.toLowerCase();
    return allSats.filter(s => s.name.toLowerCase().includes(q) || s.id.includes(q)).slice(0, 8);
  }, [searchQuery, allSats]);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center w-64" style={{ maxWidth: '90%' }}>
      <div className="search-input-wrapper w-full">
        <Search size={15} className="search-input-icon" />
        <input
          type="text"
          className="search-input"
          placeholder="Search satellites..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>

      {searchResults.length > 0 && (
        <div className="w-full mt-2 glass-panel flex flex-col overflow-hidden max-h-64 overflow-y-auto">
          {searchResults.map(sat => (
            <button
              key={sat.id}
              className="w-full text-left px-3 py-2 hover:bg-white/10 border-b border-[var(--panel-border)] last:border-none flex justify-between items-center transition-colors"
              onClick={() => {
                onSelectSatellite(sat);
                setSearchQuery('');
              }}
            >
              <div className="flex flex-col">
                <span className="text-sm font-bold text-white truncate">{sat.name}</span>
                <span className="text-xs text-secondary font-mono">NORAD: {sat.id}</span>
              </div>
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: sat.colorHex }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
