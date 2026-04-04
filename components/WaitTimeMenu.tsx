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
  darkMode?: boolean;
}

const WaitTimeMenu: React.FC<WaitTimeMenuProps> = ({ hospitals, onGetDirections, darkMode = true }) => {
  const dm = darkMode;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-4">
      {hospitals.map((h, idx) => (
        <div key={idx} className={`border rounded-lg shadow-lg p-6 flex flex-col justify-between min-h-[200px] ${dm ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`}>
          <div>
            <h3 className={`text-lg font-bold mb-1 ${dm ? 'text-slate-100' : 'text-gray-900'}`}>{h.name}</h3>
            <div className={`text-sm mb-2 ${dm ? 'text-slate-400' : 'text-gray-600'}`}>{h.address}{h.city ? `, ${h.city}` : ""}</div>
            <div className="mb-2">
              <span className={`block text-xs ${dm ? 'text-slate-400' : 'text-gray-500'}`}>Estimated Wait Time</span>
              <span className={`text-2xl font-bold ${h.waitTime === 'N/A' ? (dm ? 'text-slate-300' : 'text-gray-600') : h.waitTime.includes('h') ? 'text-yellow-500' : 'text-green-600'}`}>{h.waitTime}</span>
            </div>
            {h.note && <div className={`text-xs mb-2 ${dm ? 'text-slate-400' : 'text-gray-500'}`}>{h.note}</div>}
          </div>
          <div className="flex items-center justify-between mt-4">
            <span className={`text-xs ${dm ? 'text-slate-500' : 'text-gray-400'}`}>{h.updated}</span>
            <button
              className={`hover:underline text-sm font-medium ${dm ? 'text-sky-400' : 'text-sky-600'}`}
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
