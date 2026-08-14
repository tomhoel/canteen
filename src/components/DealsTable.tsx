import React, { useState } from "react";
import type { ProductOffer } from "@/lib/types";

interface DealsTableProps {
  deals: ProductOffer[];
}

type SortField = "store" | "matchedIngredient" | "name" | "price" | "savingsPercent";

export function DealsTable({ deals }: DealsTableProps) {
  const [sortField, setSortField] = useState<SortField>("price");
  const [sortAsc, setSortAsc] = useState(true);

  const sortedDeals = [...deals].sort((a, b) => {
    const valA = a[sortField] ?? "";
    const valB = b[sortField] ?? "";
    if (typeof valA === "number" && typeof valB === "number") {
      return sortAsc ? valA - valB : valB - valA;
    }
    return sortAsc
      ? String(valA).localeCompare(String(valB))
      : String(valB).localeCompare(String(valA));
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  return (
    <div
      style={{
        overflowX: "auto",
        borderRadius: "12px",
        border: "1px solid #ece4d8",
        background: "#ffffff",
        margin: "1rem 0",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
        <thead>
          <tr style={{ background: "#f8f5ee", borderBottom: "1px solid #ece4d8" }}>
            {[
              { key: "store", label: "Butikk" },
              { key: "matchedIngredient", label: "Ingrediens" },
              { key: "name", label: "Produkt" },
              { key: "price", label: "Pris" },
              { key: "savingsPercent", label: "Rabatt" },
            ].map((col) => (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key as SortField)}
                style={{
                  padding: "10px 12px",
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  color: "#6b6158",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                {col.label} {sortField === col.key ? (sortAsc ? " 🔼" : " 🔽") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedDeals.map((deal) => (
            <tr key={deal.id} style={{ borderBottom: "1px solid #f2ebdf" }}>
              <td style={{ padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  {deal.storeLogo ? (
                    <img
                      src={deal.storeLogo}
                      alt={deal.store}
                      style={{ width: "20px", height: "20px", objectFit: "contain", borderRadius: "4px" }}
                    />
                  ) : (
                    <span
                      style={{
                        width: "10px",
                        height: "10px",
                        borderRadius: "50%",
                        background: deal.storeColor || "#888888",
                        display: "inline-block",
                      }}
                    />
                  )}
                  <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{deal.store}</span>
                </div>
              </td>
              <td style={{ padding: "10px 12px", fontSize: "0.85rem", color: "#6b6158", fontWeight: 500 }}>
                {deal.matchedIngredient}
              </td>
              <td style={{ padding: "10px 12px" }}>
                <a
                  href={deal.productUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#1a1511", textDecoration: "none", fontSize: "0.85rem", fontWeight: 600 }}
                >
                  {deal.name}
                </a>
              </td>
              <td style={{ padding: "10px 12px" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 700, color: "#c8741a", fontSize: "0.9rem" }}>
                    {deal.price.toFixed(2).replace(".", ",")} kr
                  </span>
                  {deal.originalPrice && (
                    <span style={{ fontSize: "0.75rem", color: "#a09890", textDecoration: "line-through" }}>
                      {deal.originalPrice.toFixed(2).replace(".", ",")} kr
                    </span>
                  )}
                </div>
              </td>
              <td style={{ padding: "10px 12px" }}>
                {deal.savingsPercent ? (
                  <span
                    style={{
                      background: "rgba(74, 158, 85, 0.12)",
                      color: "#4a9e55",
                      fontWeight: 700,
                      fontSize: "0.75rem",
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    -{deal.savingsPercent}%
                  </span>
                ) : (
                  <span style={{ fontSize: "0.75rem", color: "#a09890" }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
