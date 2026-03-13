"use client"

interface AnimatedGradientProps {
  color1?: string
  color2?: string
  color3?: string
  color4?: string
}

export function AnimatedGradient({
  color1 = "#f0d9bc",
  color2 = "#e8c9a0",
  color3 = "#f5e8d4",
  color4 = "#ddd0be",
}: AnimatedGradientProps) {
  return (
    <div className="animated-gradient-root" aria-hidden="true">
      <div className="animated-gradient-blob blob-1" style={{ background: color1 }} />
      <div className="animated-gradient-blob blob-2" style={{ background: color2 }} />
      <div className="animated-gradient-blob blob-3" style={{ background: color3 }} />
      <div className="animated-gradient-blob blob-4" style={{ background: color4 }} />
    </div>
  )
}
