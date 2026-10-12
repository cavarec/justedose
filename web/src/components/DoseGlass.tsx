import { useEffect, useId, useState } from 'react';
import type { DoseResult } from '@shared/types';

/**
 * Verre doseur : montre la dose recommandée (mL ou g) sur une échelle graduée.
 * Un trait pointillé marque la dose habituelle (emballage, tambour plein) : l'écart = l'économie.
 * Capsules : on dessine les capsules à prendre.
 */

const W = 100;
const H = 150;
const TOP = 14; // haut de la zone graduée
const BOTTOM = 136; // fond du verre
const LEFT = 16;
const RIGHT = 70;
const INNER_H = BOTTOM - TOP;

/** Échelle : 100, 150, 200… la plus petite qui laisse de la marge au-dessus du plus grand repère. */
export function glassScale(dose: number, baseline: number): number {
  const need = Math.max(dose, baseline) * 1.15;
  return Math.max(100, Math.ceil(need / 50) * 50);
}

function Capsules({ count }: { count: number }) {
  const shown = Math.min(count, 4);
  return (
    <svg viewBox="0 0 100 150" className="h-36 w-24" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => {
        const y = 75 + (i - (shown - 1) / 2) * 36;
        return (
          <g key={i} transform={`translate(50 ${y}) rotate(${i % 2 ? 8 : -8})`}>
            <rect x="-30" y="-12" width="60" height="24" rx="12" fill="#f8fafc" />
            <path d="M0 -12h18a12 12 0 0 1 0 24H0z" fill="#38bdf8" />
            <rect x="-30" y="-12" width="60" height="24" rx="12" fill="none" stroke="#0f172a" strokeOpacity="0.25" />
          </g>
        );
      })}
      {count > shown && (
        <text x="50" y="146" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">
          × {count}
        </text>
      )}
    </svg>
  );
}

export function DoseGlass({
  dose,
  baselineDose,
  unit,
  type,
}: {
  dose: number;
  baselineDose: number;
  unit: DoseResult['unit'];
  type: 'liquid' | 'powder' | 'capsules';
}) {
  const clipId = useId();
  // Le liquide monte à l'affichage (sauf si l'utilisateur préfère moins d'animations : voir la classe).
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (unit === 'capsule') return <Capsules count={dose} />;

  const max = glassScale(dose, baselineDose);
  const yOf = (v: number) => BOTTOM - (Math.min(v, max) / max) * INNER_H;
  const levelY = yOf(dose);
  const showBaseline = baselineDose > dose;
  const minor = max <= 100 ? 10 : 25;
  const ticks: number[] = [];
  for (let v = minor; v <= max; v += minor) ticks.push(v);
  const label = `Verre doseur rempli à ${dose} ${unit}${showBaseline ? `, au lieu de ${baselineDose} ${unit} habituellement` : ''}`;
  const liquid = type === 'powder' ? '#f1f5f9' : '#7dd3fc';

  return (
    <figure className="flex flex-col items-center">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-24" role="img" aria-label={label}>
        <defs>
          <clipPath id={clipId}>
            <rect x={LEFT + 2} y={TOP} width={RIGHT - LEFT - 4} height={INNER_H - 1} rx="5" />
          </clipPath>
        </defs>

        {/* verre */}
        <rect x={LEFT} y={TOP - 4} width={RIGHT - LEFT} height={INNER_H + 8} rx="9" fill="#ffffff" fillOpacity="0.14" />

        {/* contenu : un rectangle plein qui glisse jusqu'au bon niveau */}
        <g clipPath={`url(#${clipId})`}>
          <g
            className="transition-transform duration-1000 ease-out motion-reduce:transition-none"
            style={{ transform: `translateY(${filled ? 0 : BOTTOM - TOP}px)` }}
          >
            <rect x={LEFT} y={levelY} width={RIGHT - LEFT} height={BOTTOM - levelY + 2} fill={liquid} fillOpacity="0.95" />
            <rect x={LEFT} y={levelY} width={RIGHT - LEFT} height="3" fill="#ffffff" fillOpacity="0.7" />
          </g>
        </g>

        {/* contour + reflet */}
        <rect x={LEFT} y={TOP - 4} width={RIGHT - LEFT} height={INNER_H + 8} rx="9" fill="none" stroke="#ffffff" strokeWidth="2.5" />
        <path d={`M${LEFT + 7} ${TOP + 6}v${INNER_H - 24}`} stroke="#ffffff" strokeOpacity="0.35" strokeWidth="3" strokeLinecap="round" />

        {/* graduations */}
        {ticks.map((v) => {
          const major = v % 50 === 0;
          return (
            <g key={v}>
              <line x1={RIGHT} x2={RIGHT + (major ? 9 : 5)} y1={yOf(v)} y2={yOf(v)} stroke="#ffffff" strokeWidth={major ? 2 : 1.4} strokeLinecap="round" />
              {major && (
                <text x={RIGHT + 11} y={yOf(v) + 3.5} fontSize="10" fontWeight="600" fill="#ffffff" fillOpacity="0.95">
                  {v}
                </text>
              )}
            </g>
          );
        })}

        {/* dose habituelle */}
        {showBaseline && (
          <line x1={LEFT - 6} x2={RIGHT} y1={yOf(baselineDose)} y2={yOf(baselineDose)} stroke="#fcd34d" strokeWidth="2.5" strokeDasharray="5 3.5" strokeLinecap="round" />
        )}
      </svg>
      {showBaseline && (
        <figcaption className="-mt-1 flex items-center gap-1.5 text-xs font-medium text-teal-50">
          <span aria-hidden="true" className="inline-block h-0 w-4 border-t-2 border-dashed border-amber-300" />
          dose habituelle
        </figcaption>
      )}
    </figure>
  );
}
