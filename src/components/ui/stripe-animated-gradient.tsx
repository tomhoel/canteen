"use client"

interface AnimatedGradientProps {
  color1?: string
  color2?: string
  color3?: string
  color4?: string
}

/** A disc fading out over its outer third — what blur(45px) on a solid disc looked like, with no filter. */
const soft = (c: string) => `radial-gradient(closest-side, ${c} 62%, ${c}00 100%)`

export function AnimatedGradient({
  color1 = "#f0d9bc",
  color2 = "#e8c9a0",
  color3 = "#f5e8d4",
  color4 = "#ddd0be",
}: AnimatedGradientProps) {
  return (
    <div className="animated-gradient-root" aria-hidden="true">
      <div className="animated-gradient-blob blob-1" style={{ background: soft(color1) }} />
      <div className="animated-gradient-blob blob-2" style={{ background: soft(color2) }} />
      <div className="animated-gradient-blob blob-3" style={{ background: soft(color3) }} />
      <div className="animated-gradient-blob blob-4" style={{ background: soft(color4) }} />
    </div>
  )
}
