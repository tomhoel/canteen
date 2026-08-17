import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getWeeklyMenu } from "@/lib/api-client";
import HomeClient from "@/components/HomeClient";
import LoadingScreen from "@/components/LoadingScreen";

const searchSchema = z.object({
  day: z.string().optional(),
  canteen: z.string().optional(),
  tab: z.enum(["meny", "deals"]).optional(),
  week: z.string().optional(),
  q: z.string().optional(),
});

export const Route = createFileRoute("/")({
  validateSearch: (search) => searchSchema.parse(search),
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
  const { menuData, dishOrigins, dishDescriptions, plateImages } = Route.useLoaderData();

  return (
    <HomeClient
      initialMenu={menuData}
      initialOrigins={dishOrigins}
      initialDescriptions={dishDescriptions}
      plateImages={plateImages ?? {}}
    />
  );
}
