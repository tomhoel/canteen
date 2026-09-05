import { createFileRoute } from "@tanstack/react-router";
import { getWeeklyMenu } from "@/lib/api-client";
import HomeClient from "@/components/HomeClient";
import LoadingScreen from "@/components/LoadingScreen";

/**
 * The URL search params, validated by hand.
 *
 * This was a five-field zod schema — three optional strings, one optional
 * string enum — and zod is 13 KB brotli on the critical path of a page whose
 * whole job is to show three lunches. Nothing else in the app uses it.
 *
 * Behaviour is deliberately identical: unknown keys are dropped, absent keys
 * stay absent (rather than becoming undefined-valued keys, which would put
 * empty params in the URL), and `tab` only survives if it is one of the two
 * values the app knows.
 */
type Search = {
  day?: string;
  canteen?: string;
  tab?: "meny" | "deals";
  week?: string;
  q?: string;
};

const TABS = ["meny", "deals"] as const;

function validateSearch(search: Record<string, unknown>): Search {
  const out: Search = {};

  for (const key of ["day", "canteen", "week", "q"] as const) {
    const value = search[key];
    if (typeof value === "string") out[key] = value;
  }

  const tab = search.tab;
  if (typeof tab === "string" && (TABS as readonly string[]).includes(tab)) {
    out.tab = tab as Search["tab"];
  }

  return out;
}

export const Route = createFileRoute("/")({
  validateSearch,
  loaderDeps: ({ search }) => ({ week: search.week }),
  loader: async ({ deps }) => {
    return await getWeeklyMenu(deps.week);
  },
  // Not a bespoke placeholder: the same app shell HomeClient renders, with a
  // SkeletonCard in each card slot. The screen that used to live here laid the
  // cards out in its own inline-styled grid — and, because it rendered the
  // *default* export of SkeletonCard.tsx (a group of three) three times over,
  // put nine of them on screen inside three horizontally scrolling boxes.
  pendingComponent: LoadingScreen,
  errorComponent: ErrorComponent,
  component: HomeComponent,
});

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
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
        onClick={reset}
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

function HomeComponent() {
  const { weekId, menuData, dishOrigins, dishDescriptions, plateImages } = Route.useLoaderData();

  return (
    <HomeClient
      initialMenu={menuData}
      servedWeekId={weekId}
      initialOrigins={dishOrigins}
      initialDescriptions={dishDescriptions}
      plateImages={plateImages ?? {}}
    />
  );
}
