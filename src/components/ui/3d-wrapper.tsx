"use client"

import { useRef, useCallback, useState, useEffect } from "react"
import { motion, useMotionValue, useSpring, useTransform } from "motion/react"

interface Wrapper3DProps {
  children: React.ReactNode
  maxRotation?: number
  translateZ?: number
  perspective?: boolean
  className?: string
}

function DesktopTiltWrapper({
  children,
  maxRotation = 8,
  translateZ = 16,
  perspective = true,
  className,
}: Wrapper3DProps) {
  const ref = useRef<HTMLDivElement>(null)

  const x = useMotionValue(0)
  const y = useMotionValue(0)

  // Fluid, organic spring physics for interactive 3D tilt
  const mouseX = useSpring(x, { stiffness: 260, damping: 24, mass: 0.6 })
  const mouseY = useSpring(y, { stiffness: 260, damping: 24, mass: 0.6 })

  const rotateX = useTransform(mouseY, [-0.5, 0.5], [`${maxRotation}deg`, `-${maxRotation}deg`])
  const rotateY = useTransform(mouseX, [-0.5, 0.5], [`-${maxRotation}deg`, `${maxRotation}deg`])

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const { left, top, width, height } = el.getBoundingClientRect()
    const normX = (e.clientX - left) / width - 0.5
    const normY = (e.clientY - top) / height - 0.5
    x.set(normX)
    y.set(normY)
    el.style.setProperty("--card-mx", normX.toFixed(3))
    el.style.setProperty("--card-my", normY.toFixed(3))
  }, [x, y])

  const onLeave = useCallback(() => {
    x.set(0)
    y.set(0)
    const el = ref.current
    if (el) {
      el.style.setProperty("--card-mx", "0")
      el.style.setProperty("--card-my", "0")
    }
  }, [x, y])

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{
        transformStyle: "preserve-3d",
        perspective: perspective ? 800 : undefined,
        rotateX,
        rotateY,
        z: translateZ,
      }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      {children}
    </motion.div>
  )
}

export function Wrapper3D(props: Wrapper3DProps) {
  const [canHover, setCanHover] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(hover: hover) and (pointer: fine)").matches : false
  )

  useEffect(() => {
    // Only enable 3D mouse tilt on desktop devices with fine pointer (mouse/trackpad)
    const mql = window.matchMedia("(hover: hover) and (pointer: fine)")
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
