import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getWeeklyMenu } from "@/lib/api-client";
import HomeClient from "@/components/HomeClient";
import SkeletonCard from "@/components/SkeletonCard";

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
  pendingComponent: PendingComponent,
  errorComponent: ErrorComponent,
  component: HomeComponent,
});

function PendingComponent() {
  return (
    <div style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: "1.5rem",
          marginTop: "2rem",
        }}
      >
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}

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
