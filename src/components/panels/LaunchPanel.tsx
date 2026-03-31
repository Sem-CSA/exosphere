import type { LaunchData } from '../../types';

interface LaunchPanelProps {
  selectedLaunch: LaunchData;
  onClose: () => void;
}

export default function LaunchPanel({ selectedLaunch, onClose }: LaunchPanelProps) {
  return (
    <div className="absolute top-4 right-4 z-10 glass-panel p-5 w-80 flex flex-col shadow-2xl">
      <div className="flex justify-between items-start mb-4">
        <h2 className="text-lg font-bold text-orange-400">{selectedLaunch.name}</h2>
        <button className="text-secondary hover:text-white font-bold ml-2 bg-transparent" onClick={onClose}>✕</button>
      </div>

      <div className="flex flex-col gap-3 text-sm text-secondary">
        <div className="flex justify-between border-b pb-2 border-[var(--panel-border)]">
          <span className="text-white">Date / Net</span>
          <span className="font-mono text-orange-400">
            {new Date(selectedLaunch.net).toLocaleString()}
          </span>
        </div>

        <div className="flex justify-between border-b pb-2 border-[var(--panel-border)]">
          <span className="text-white">Provider</span>
          <span className="font-semibold text-white truncate max-w-[60%] text-right" title={selectedLaunch.provider}>{selectedLaunch.provider}</span>
        </div>

        <div className="flex justify-between border-b pb-2 border-[var(--panel-border)]">
          <span className="text-white">Status</span>
          <span className="font-semibold text-white">{selectedLaunch.status}</span>
        </div>

        <div className="mt-1">
          <span className="text-white text-xs uppercase tracking-wider mb-2 block">Mission</span>
          <div className="text-sm pb-2 border-b border-[var(--panel-border)]">
            <span className="font-bold text-white block mb-1">{selectedLaunch.mission?.name || 'Unknown'}</span>
            <span className="line-clamp-3" title={selectedLaunch.mission?.description}>{selectedLaunch.mission?.description || 'No description available.'}</span>
          </div>
        </div>

        <div className="mt-1 pt-1">
          <span className="text-white text-xs uppercase tracking-wider mb-2 block">Location</span>
          <div className="text-sm">
            <span className="block font-medium text-white">{selectedLaunch.pad?.name}</span>
            <span className="block text-xs mt-1">{selectedLaunch.pad?.location}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
