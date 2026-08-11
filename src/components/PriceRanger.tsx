import React, { useRef } from "react";
import { useRanger, type Ranger } from "@tanstack/react-ranger";

interface PriceRangerProps {
  min?: number;
  max?: number;
  value: number;
  onChange: (val: number) => void;
  step?: number;
}

export function PriceRanger({
  min = 0,
  max = 300,
  value,
  onChange,
  step = 5,
}: PriceRangerProps) {
  const rangerRef = useRef<HTMLDivElement>(null);

  const ranger = useRanger<HTMLDivElement>({
    getRangerElement: () => rangerRef.current,
    values: [value],
    min,
    max,
    stepSize: step,
    onChange: (instance: Ranger<HTMLDivElement>) => {
      const val = instance.sortedValues[0];
      if (typeof val === "number") {
        onChange(val);
      }
    },
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "8px 12px",
        background: "#f9f6f0",
        borderRadius: "10px",
        border: "1px solid #ece4d8",
        margin: "0.5rem 0",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.8rem",
          fontWeight: 600,
          color: "#6b6158",
        }}
      >
        <span>Makspris filter:</span>
        <span style={{ color: "#c8741a", fontWeight: 700 }}>
          {value >= max ? "Alle priser" : `Inntil ${value} kr`}
        </span>
      </div>

      <div
        ref={rangerRef}
        style={{
          position: "relative",
          height: "12px",
          display: "flex",
          alignItems: "center",
          userSelect: "none",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: "6px",
            borderRadius: "3px",
            background: "#e8dfd1",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${ranger.getPercentageForValue(min)}%`,
            width: `${ranger.getPercentageForValue(value)}%`,
            height: "6px",
            borderRadius: "3px",
            background: "#c8741a",
          }}
        />

        {ranger.handles().map((handle, i) => (
          <button
            key={i}
            onMouseDown={handle.onMouseDownHandler}
            onTouchStart={handle.onTouchStart}
            style={{
              width: "18px",
              height: "18px",
              borderRadius: "50%",
              background: "#ffffff",
              border: "2px solid #c8741a",
              boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
              outline: "none",
              cursor: "grab",
              position: "absolute",
              top: "50%",
              left: `${ranger.getPercentageForValue(value)}%`,
              transform: "translate(-50%, -50%)",
              zIndex: 2,
            }}
          />
        ))}
      </div>
    </div>
  );
}
