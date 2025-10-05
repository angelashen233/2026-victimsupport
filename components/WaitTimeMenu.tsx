import React from "react";

export interface WaitTime {
  name: string;
  address: string;
  city: string;
  waitTime: string; // e.g. "4h 34m" or "N/A"
  updated: string; // e.g. "Updated 14 minutes ago"
  note?: string;
}

interface WaitTimeMenuProps {
  hospitals: WaitTime[];
  onGetDirections?: (hospital: WaitTime) => void;
}

const WaitTimeMenu: React.FC<WaitTimeMenuProps> = ({ hospitals, onGetDirections }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-4">
      {hospitals.map((h, idx) => (
        <div key={idx} className="bg-slate-800 border border-slate-700 rounded-lg shadow-lg p-6 flex flex-col justify-between min-h-[200px]">
          <div>
            <h3 className="text-lg font-bold text-slate-100 mb-1">{h.name}</h3>
            <div className="text-sm text-slate-400 mb-2">{h.address}{h.city ? `, ${h.city}` : ""}</div>
            <div className="mb-2">
              <span className="block text-xs text-slate-400">Estimated Wait Time</span>
              <span className={`text-2xl font-bold ${h.waitTime === 'N/A' ? 'text-slate-300' : h.waitTime.includes('h') ? 'text-yellow-400' : 'text-green-400'}`}>{h.waitTime}</span>
            </div>
            {h.note && <div className="text-xs text-slate-400 mb-2">{h.note}</div>}
          </div>
          <div className="flex items-center justify-between mt-4">
            <span className="text-xs text-slate-500">{h.updated}</span>
            <button
              className="text-sky-400 hover:underline text-sm font-medium"
              onClick={() => onGetDirections && onGetDirections(h)}
            >
              Get Directions →
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default WaitTimeMenu;
