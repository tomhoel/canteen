import { Sheet, SheetContent } from "canteen";

/*
  The panel half of the sheet. It cannot render outside a `Sheet` — it reads the
  open state and the drag handlers from that context — so every story composes
  the pair. The axis swept here is the panel's own chrome: handle, close button
  and detent.
*/

const noop = () => {};

const Body = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      padding: "4px 44px 12px 4px",
      fontFamily: "Outfit, sans-serif",
      fontSize: 14,
      lineHeight: 1.45,
      color: "var(--text-secondary, #6b6158)",
    }}
  >
    <p style={{ margin: "0 0 14px" }}>{children}</p>
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

const inSheet = (content: React.ReactNode) => (
  <Sheet open onOpenChange={noop}>
    {content}
  </Sheet>
);

/** Both affordances: the drag grabber and the close button. */
export const Default = () =>
  inSheet(
    <SheetContent aria-label="Detaljer" onClose={noop}>
      <Body>Grabber øverst, lukkeknapp øverst til høyre.</Body>
    </SheetContent>
  );

/** Grabber only — drag to dismiss, no button. */
export const HandleOnly = () =>
  inSheet(
    <SheetContent showCloseButton={false} aria-label="Detaljer" onClose={noop}>
      <Body>Dra ned for å lukke.</Body>
    </SheetContent>
  );

/** Button only. The desktop panel takes this shape — there is nothing to drag. */
export const CloseButtonOnly = () =>
  inSheet(
    <SheetContent showHandle={false} aria-label="Detaljer" onClose={noop}>
      <Body>Ingen grabber; panelet lukkes med knappen.</Body>
    </SheetContent>
  );

/** The medium detent, opened to a fixed height. */
export const MediumDetent = () =>
  inSheet(
    <SheetContent detent="medium" aria-label="Detaljer" onClose={noop}>
      <Body>Fast høyde i stedet for å følge innholdet.</Body>
    </SheetContent>
  );
