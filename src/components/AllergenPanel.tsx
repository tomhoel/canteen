import { ALLERGEN_COLORS } from "@/lib/constants";
import type { Allergen } from "@/lib/types";

interface AllergenPanelProps {
  dayAllergens: Allergen[];
  allergenOpen: boolean;
  lang: "no" | "en";
  onToggle: () => void;
}

export default function AllergenPanel({ dayAllergens, allergenOpen, lang, onToggle }: AllergenPanelProps) {
  if (dayAllergens.length === 0) return null;

  return (
    <div className="allergen-section" onClick={e => e.stopPropagation()}>
      <div className="allergen-toggle" onClick={e => { e.stopPropagation(); onToggle(); }}>
        <span className="allergen-toggle-icon">&#x26A0;&#xFE0F;</span>
        <span className="allergen-toggle-text">
          {dayAllergens.length} {lang === "no"
            ? (dayAllergens.length === 1 ? "allergen i dag" : "allergener i dag")
            : (dayAllergens.length === 1 ? "allergen today" : "allergens today")}
        </span>
        <span className={`allergen-toggle-arrow ${allergenOpen ? "open" : ""}`}>&#x25BC;</span>
      </div>
      {allergenOpen && (
        <div className="allergen-panel">
          <div className="allergen-panel-title">
            {lang === "no" ? "Allergener i dagens meny" : "Allergens in today's menu"}
          </div>
          <div className="allergen-grid">
            {dayAllergens.map((a, idx) => (
              <div key={a.id} className="allergen-item" style={{ animationDelay: `${idx * 40}ms` }}>
                <span className="allergen-item-dot" style={{ background: ALLERGEN_COLORS[a.name] || "#8E8E93" }}>
                  {a.name.charAt(0)}
                </span>
                <span className="allergen-item-name">{a.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
