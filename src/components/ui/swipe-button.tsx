"use client"

import { useRef, useState } from "react"
import confetti from "canvas-confetti"

interface SwipeButtonProps {
  onSwipeComplete: () => void
  label?: string
  disabled?: boolean
}

export function SwipeButton({ onSwipeComplete, label = "Swipe to vote", disabled = false }: SwipeButtonProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  const [done, setDone] = useState(false)
  const dragging = useRef(false)
  const startX = useRef(0)

  const THUMB_SIZE = 48
  const PAD = 4

  function getMax() {
    return (trackRef.current?.offsetWidth ?? 200) - THUMB_SIZE - PAD * 2
  }

  function begin(clientX: number) {
    if (done || disabled) return
    dragging.current = true
    startX.current = clientX - offset
  }

  function move(clientX: number) {
    if (!dragging.current || done || disabled) return
    const x = Math.max(0, Math.min(clientX - startX.current, getMax()))
    setOffset(x)
    if (x >= getMax() - 2) complete()
  }

  function release() {
    if (!done) setOffset(0)
    dragging.current = false
  }

  function complete() {
    dragging.current = false
    setOffset(getMax())
    setDone(true)
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } })
    onSwipeComplete()
  }

  const pct = getMax() > 0 ? offset / getMax() : 0

  return (
    <div
      ref={trackRef}
      className={`swipe-btn-track${done ? " swipe-btn-done" : ""}${disabled ? " swipe-btn-disabled" : ""}`}
      onMouseMove={e => move(e.clientX)}
      onMouseUp={release}
      onMouseLeave={release}
      onTouchMove={e => { move(e.touches[0].clientX); }}
      onTouchEnd={release}
    >
      {/* fill */}
      <div className="swipe-btn-fill" style={{ width: `${PAD + THUMB_SIZE / 2 + offset}px` }} />

      {/* label */}
      <span className="swipe-btn-label" style={{ opacity: done ? 0 : 1 - pct * 1.5 }}>
        {label}
      </span>

      {/* done label */}
      {done && <span className="swipe-btn-label swipe-btn-label-done">✔ Voted!</span>}

      {/* thumb */}
      <div
        className="swipe-btn-thumb"
        style={{ transform: `translateX(${offset}px)` }}
        onMouseDown={e => { begin(e.clientX); e.preventDefault() }}
        onTouchStart={e => { begin(e.touches[0].clientX); e.preventDefault() }}
      >
        {done ? "✔" : "🗳️"}
      </div>
    </div>
  )
}
