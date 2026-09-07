/**
 * What the screen showed when the menu could not be loaded.
 *
 * Lifted unchanged from the route's `errorComponent`, including the Norwegian
 * copy and the inline styles — this is a failure screen, and the one thing it
 * must not do is look different from the one people have already seen.
 * `reset` became `onRetry`; see App.tsx for how it is wired.
 */
export default function MenuError({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  return (
    <div
      style={{
        padding: "3rem 1.5rem",
        textAlign: "center",
        maxWidth: "500px",
        margin: "4rem auto",
        background: "white",
        borderRadius: "16px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
      }}
    >
      <h2 style={{ fontFamily: "Outfit, sans-serif", color: "#c41230", marginBottom: "0.5rem" }}>
        Kunne ikke laste menyen
      </h2>
      <p style={{ color: "#6b6158", marginBottom: "1.5rem" }}>
        {error.message || "Det oppstod en feil ved henting av menydata."}
      </p>
      <button
        onClick={onRetry}
        style={{
          background: "#c8741a",
          color: "white",
          border: "none",
          padding: "0.75rem 1.5rem",
          borderRadius: "8px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Prøv igjen
      </button>
    </div>
  );
}
