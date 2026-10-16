/** Flat illustration for the login panel: a coastal hotel with a palm and a guest arriving. */
export function HotelIllustration({ className = "" }: { className?: string }) {
  const teal = "#0d6b5f";
  const tealSoft = "#cfe7e2";
  const sand = "#e9e1d0";
  const ink = "#1c2321";
  const windows = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const lit = (row * 3 + col) % 5 === 0;
      windows.push(
        <rect key={`${row}-${col}`} x={150 + col * 34} y={78 + row * 34} width="20" height="22" rx="3" fill={lit ? "#f4c76b" : tealSoft} />,
      );
    }
  }
  return (
    <svg viewBox="0 0 420 300" role="img" aria-label="Hotel" className={className}>
      <ellipse cx="210" cy="272" rx="190" ry="14" fill={sand} />
      {/* main building */}
      <rect x="130" y="50" width="160" height="222" rx="6" fill="#ffffff" stroke={ink} strokeWidth="2.5" />
      <rect x="130" y="50" width="160" height="16" rx="6" fill={teal} />
      {windows}
      <rect x="186" y="222" width="48" height="50" rx="4" fill={teal} />
      <line x1="210" y1="222" x2="210" y2="272" stroke="#ffffff" strokeWidth="2" />
      <path d="M170 222 h80 l-8 -12 h-64 z" fill={ink} />
      {/* side wing */}
      <rect x="290" y="130" width="80" height="142" rx="4" fill="#ffffff" stroke={ink} strokeWidth="2.5" />
      {[0, 1, 2].map((r) => (
        <g key={r}>
          <rect x="304" y={148 + r * 38} width="20" height="22" rx="3" fill={tealSoft} />
          <rect x="336" y={148 + r * 38} width="20" height="22" rx="3" fill={r === 1 ? "#f4c76b" : tealSoft} />
        </g>
      ))}
      {/* palm tree */}
      <path d="M78 272 C82 220 84 190 92 150" stroke="#8a6a43" strokeWidth="7" fill="none" strokeLinecap="round" />
      <path d="M92 150 C70 138 52 142 40 156 C60 150 76 152 92 150 Z" fill={teal} />
      <path d="M92 150 C104 128 124 124 140 130 C120 134 106 140 92 150 Z" fill={teal} />
      <path d="M92 150 C80 128 64 120 48 124 C66 132 80 140 92 150 Z" fill="#14897a" />
      <path d="M92 150 C112 150 128 160 134 176 C118 164 104 158 92 150 Z" fill="#14897a" />
      {/* guest with suitcase */}
      <circle cx="330" cy="214" r="9" fill={ink} />
      <path d="M321 228 h18 l4 44 h-26 z" fill={teal} />
      <rect x="348" y="246" width="20" height="26" rx="3" fill="#f4c76b" stroke={ink} strokeWidth="2" />
      <path d="M353 246 v-6 h10 v6" stroke={ink} strokeWidth="2" fill="none" />
      {/* sun */}
      <circle cx="368" cy="58" r="20" fill="#f4c76b" opacity="0.9" />
    </svg>
  );
}
