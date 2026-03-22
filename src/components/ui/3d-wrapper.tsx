"use client"

import { useRef, useCallback } from "react"

interface Wrapper3DProps {
  children: React.ReactNode
  maxRotation?: number
  translateZ?: number
  perspective?: boolean
  className?: string
}

export function Wrapper3D({
  children,
  maxRotation = 10,
  translateZ = 20,
  perspective = true,
  className,
}: Wrapper3DProps) {
  const ref = useRef<HTMLDivElement>(null)

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const { left, top, width, height } = el.getBoundingClientRect()
    const x = (e.clientX - left) / width - 0.5   // -0.5 to 0.5
    const y = (e.clientY - top) / height - 0.5
    const rotY = x * maxRotation
    const rotX = -y * maxRotation
    const persp = perspective ? `perspective(800px) ` : ""
    el.style.transform = `${persp}rotateX(${rotX}deg) rotateY(${rotY}deg) translateZ(${translateZ}px)`
    el.style.setProperty("--card-mx", x.toFixed(3))
    el.style.setProperty("--card-my", y.toFixed(3))
  }, [maxRotation, translateZ, perspective])

  const onLeave = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.classList.add("card-returning")
    el.style.transition = "transform 0.5s cubic-bezier(0.23, 1, 0.32, 1)"
    el.style.transform = "rotateX(0deg) rotateY(0deg) translateZ(0px)"
    el.style.setProperty("--card-mx", "0")
    el.style.setProperty("--card-my", "0")
    setTimeout(() => {
      if (ref.current) {
        ref.current.style.transition = ""
        ref.current.classList.remove("card-returning")
      }
    }, 500)
  }, [])

  const onEnter = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.transition = "transform 0.1s ease-out"
    setTimeout(() => { if (ref.current) ref.current.style.transition = "" }, 100)
  }, [])

  return (
    <div
      ref={ref}
      className={className}
      style={{ transformStyle: "preserve-3d", willChange: "transform" }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onMouseEnter={onEnter}
    >
      {children}
    </div>
  )
}
