import { Wrapper3D } from "canteen";

/*
  A pointer-tracking tilt for desktop. It deliberately renders as a plain
  passthrough on touch — the phone's GPU budget is stripped — so a static
  capture shows the resting state. The stories exist to show the wrapper does
  not disturb what it wraps.
*/

const Card = ({ label }: { label: string }) => (
  <div
    style={{
      width: 260,
      padding: "28px 24px",
      borderRadius: "var(--r-lg, 24px)",
      background: "linear-gradient(180deg, #fffaf0 0%, #fef3e2 38%, #fff 52%)",
      border: "1px solid rgba(236, 228, 216, 0.6)",
      boxShadow: "var(--e-2, 0 2px 8px rgba(60,30,0,0.10))",
      fontFamily: "Outfit, sans-serif",
    }}
  >
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "var(--accent-orange, #c8741a)" }}>
      Eat the street
    </div>
    <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary, #1a1511)", marginTop: 6, lineHeight: 1.35 }}>
      {label}
    </div>
  </div>
);

/** Resting state, default tilt budget. */
export const Default = () => (
  <Wrapper3D>
    <Card label="Tandoori kyllinglår med ris og saus" />
  </Wrapper3D>
);

/*
  Deliberately one story. `maxRotation`, `translateZ` and `perspective` only
  change what happens while a pointer moves across the card, and the capture is
  static — three configurations rendered three identical cards, which is padding,
  not documentation. The props are described in the contract instead.
*/
