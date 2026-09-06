import { Sheet, SheetContent } from "canteen";

/*
  The sheet primitive: a bottom sheet on a phone, a centred panel on desktop,
  with drag-to-dismiss and focus containment. `Sheet` is the state container and
  takes no visual form of its own — every story therefore composes it with a
  `SheetContent`, which is the only render that is true anyway.

  Captured with cardMode "single" because the content portals to document.body.
*/

const noop = () => {};

const Body = ({ title, children }: { title: string; children?: React.ReactNode }) => (
  <div style={{ padding: "4px 44px 12px 4px", fontFamily: "Outfit, sans-serif" }}>
    <h2 style={{ margin: "0 0 8px", fontSize: 19, fontWeight: 700, color: "var(--text-primary, #1a1511)" }}>
      {title}
    </h2>
    <p style={{ margin: "0 0 14px", fontSize: 14, lineHeight: 1.45, color: "var(--text-secondary, #6b6158)" }}>
      {children}
    </p>
    <div style={{ display: "grid", gap: 10 }}>
      {[
        ["Åpningstid", "10:30 – 13:00"],
        ["Sted", "Bygg M, andre etasje"],
        ["I dag", "Varm rett, suppe og salatbar"],
        ["Betaling", "Kort og Vipps"],
      ].map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 14, borderBottom: "1px solid var(--border-light, #ece4d8)", paddingBottom: 8 }}>
          <span style={{ color: "var(--text-muted, #6f665c)" }}>{k}</span>
          <span style={{ color: "var(--text-primary, #1a1511)", fontWeight: 600 }}>{v}</span>
        </div>
      ))}
    </div>

  </div>
);

/** Open, hugging its content. */
export const Open = () => (
  <Sheet open onOpenChange={noop}>
    <SheetContent aria-label="Om kantinen" onClose={noop}>
      <Body title="Kantine M">
        Åpent 10:30–13:00. Bygg M, andre etasje. Varm rett, suppe og salatbar hver dag.
      </Body>
    </SheetContent>
  </Sheet>
);

/** The medium detent — a fixed height rather than hugging the content. */
export const MediumDetent = () => (
  <Sheet open onOpenChange={noop}>
    <SheetContent detent="medium" aria-label="Ukeoversikt" onClose={noop}>
      <Body title="Uke 37">Hele ukens meny for alle tre kantiner.</Body>
    </SheetContent>
  </Sheet>
);

/** Without the grabber — for a sheet that should only close deliberately. */
export const NoHandle = () => (
  <Sheet open onOpenChange={noop}>
    <SheetContent showHandle={false} aria-label="Bekreft" onClose={noop}>
      <Body title="Stemme registrert">Takk! Stemmen din teller mot dagens vinner.</Body>
    </SheetContent>
  </Sheet>
);

/** Neither handle nor close button: dismissal is by backdrop or drag only. */
export const Bare = () => (
  <Sheet open onOpenChange={noop}>
    <SheetContent showHandle={false} showCloseButton={false} aria-label="Laster" onClose={noop}>
      <Body title="Henter oppskrift…">Dette tar et par sekunder.</Body>
    </SheetContent>
  </Sheet>
);
