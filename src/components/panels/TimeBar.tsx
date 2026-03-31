import { Play, Pause, FastForward, RotateCcw } from 'lucide-react';

interface TimeBarProps {
  isPlaying: boolean;
  timeMultiplier: number;
  onTogglePlay: () => void;
  onMultiplyTime: () => void;
  onResetTime: () => void;
}

export default function TimeBar({
  isPlaying,
  timeMultiplier,
  onTogglePlay,
  onMultiplyTime,
  onResetTime,
}: TimeBarProps) {
  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 glass-panel px-6 py-3 flex items-center gap-6">
      <button onClick={onResetTime} className="text-secondary hover:text-white transition-colors flex items-center gap-1" title="Reset to current time">
        <RotateCcw size={18} />
        <span className="text-xs font-bold">LIVE</span>
      </button>
      <button
        onClick={onTogglePlay}
        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isPlaying ? 'bg-accent/20 text-accent border border-accent/50 box-shadow-glow' : 'bg-white/10 text-white hover:bg-white/20 border border-[var(--panel-border)]'}`}
      >
        {isPlaying ? <Pause size={20} className="fill-current" /> : <Play size={20} className="fill-current ml-1" />}
      </button>
      <button onClick={onMultiplyTime} className="text-secondary hover:text-accent transition-colors flex items-center gap-2" title="Speed up simulation">
        <FastForward size={18} />
        <span className="text-xs font-mono font-bold w-6">{timeMultiplier}x</span>
      </button>
    </div>
  );
}
