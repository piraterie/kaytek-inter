interface Props {
  size?: number
  style?: React.CSSProperties
}

export default function KaytekLogo({ size = 36, style }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0, ...style }}
    >
      <defs>
        <clipPath id="kl-left">
          <rect x="0" y="0" width="52" height="100" />
        </clipPath>
      </defs>
      {/* Hexagone — bleu marine (fond complet) */}
      <polygon
        points="72,12 93,50 72,88 28,88 7,50 28,12"
        fill="none"
        stroke="#1A2F5C"
        strokeWidth="9"
        strokeLinejoin="round"
      />
      {/* Hexagone — bleu vif (moitié gauche, par-dessus le marine) */}
      <polygon
        points="72,12 93,50 72,88 28,88 7,50 28,12"
        fill="none"
        stroke="#3B82F6"
        strokeWidth="9"
        strokeLinejoin="round"
        clipPath="url(#kl-left)"
      />
      {/* K — barre verticale */}
      <line x1="35" y1="22" x2="35" y2="78" stroke="#3B82F6" strokeWidth="9" strokeLinecap="round" />
      {/* K — crochet haut */}
      <line x1="35" y1="22" x2="54" y2="22" stroke="#3B82F6" strokeWidth="9" strokeLinecap="round" />
      {/* K — crochet bas */}
      <line x1="35" y1="78" x2="54" y2="78" stroke="#3B82F6" strokeWidth="9" strokeLinecap="round" />
      {/* K — bras supérieur */}
      <line x1="40" y1="50" x2="67" y2="22" stroke="#3B82F6" strokeWidth="9" strokeLinecap="round" />
      {/* K — bras inférieur */}
      <line x1="40" y1="50" x2="67" y2="78" stroke="#3B82F6" strokeWidth="9" strokeLinecap="round" />
    </svg>
  )
}
