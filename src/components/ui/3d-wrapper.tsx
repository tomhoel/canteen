"use client"

import { useRef, useCallback, useState, useEffect } from "react"

interface Wrapper3DProps {
  children: React.ReactNode
  maxRotation?: number
  translateZ?: number
  perspective?: boolean
  className?: string
}

/**
 * Follow-the-pointer tilt, written straight to the element.
 *
 * This used to run two motion springs (stiffness 260, damping 24, mass 0.6)
 * through useTransform into a motion.div's rotateX/rotateY. Their damping ratio
 * is 0.96 — over-damped, so the spring never overshot and a CSS ease produces
 * the same curve. The springs were also writing a second copy of data the
 * component already sets: onMove has always written --card-mx/--card-my to the
 * element, which is what the stylesheet reads.
 *
 * Desktop hover only. The matchMedia gate below means a phone never mounts
 * this, which is why the tilt cost nothing to move off the motion runtime.
 */
function DesktopTiltWrapper({
  children,
  maxRotation = 8,
  translateZ = 16,
  perspective = true,
  className,
}: Wrapper3DProps) {
  const ref = useRef<HTMLDivElement>(null)

  const onMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = ref.current
      if (!el) return
      const { left, top, width, height } = el.getBoundingClientRect()
      const normX = (e.clientX - left) / width - 0.5
      const normY = (e.clientY - top) / height - 0.5
      el.style.setProperty("--card-mx", normX.toFixed(3))
      el.style.setProperty("--card-my", normY.toFixed(3))
      // Same mapping the useTransforms had: [-0.5, 0.5] -> [max, -max] for
      // rotateX off the vertical axis, and [-0.5, 0.5] -> [-max, max] for
      // rotateY off the horizontal one.
      const rx = (-normY * 2 * maxRotation).toFixed(2)
      const ry = (normX * 2 * maxRotation).toFixed(2)
      el.style.transform = `translateZ(${translateZ}px) rotateX(${rx}deg) rotateY(${ry}deg)`
    },
    [maxRotation, translateZ]
  )

  const onLeave = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.setProperty("--card-mx", "0")
    el.style.setProperty("--card-my", "0")
    el.style.transform = `translateZ(${translateZ}px) rotateX(0deg) rotateY(0deg)`
  }, [translateZ])

  return (
    <div
      ref={ref}
      className={className}
      style={{
        transformStyle: "preserve-3d",
        perspective: perspective ? 800 : undefined,
        transform: `translateZ(${translateZ}px)`,
        // The spring's job: smooth the pointer's jitter on the way in and ease
        // back to flat on the way out. 160ms matches the settle time of the
        // 260/24/0.6 spring it replaces.
        transition: "transform 160ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      {children}
    </div>
  )
}

export function Wrapper3D(props: Wrapper3DProps) {
  const [canHover, setCanHover] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 769px) and (hover: hover) and (pointer: fine)").matches : false
  )

  useEffect(() => {
    // The width term matters as much as the pointer one. The card layout
    // switches to the phone design at 768px, but the tilt only asked about
    // the pointer — so a desktop window dragged narrow got the phone layout
    // with three live 3D springs still mounted on top of it.
    const mql = window.matchMedia("(min-width: 769px) and (hover: hover) and (pointer: fine)")
    setCanHover(mql.matches)
    const handler = (e: MediaQueryListEvent) => setCanHover(e.matches)
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }, [])

  if (!canHover) {
    return <div className={props.className}>{props.children}</div>
  }

  return <DesktopTiltWrapper {...props} />
}
