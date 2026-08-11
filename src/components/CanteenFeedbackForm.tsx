import React, { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";

const feedbackSchema = z.object({
  canteen: z.string().min(1, "Vennligst velg en kantine"),
  dishRequest: z.string().min(3, "Ønsket rett må være minst 3 tegn"),
  comments: z.string().optional(),
});

interface CanteenFeedbackFormProps {
  onClose: () => void;
}

export function CanteenFeedbackForm({ onClose }: CanteenFeedbackFormProps) {
  const [submitted, setSubmitted] = useState(false);

  const form = useForm({
    defaultValues: {
      canteen: "Fresh4you",
      dishRequest: "",
      comments: "",
    },
    onSubmit: async ({ value }) => {
      const parsed = feedbackSchema.safeParse(value);
      if (!parsed.success) return;
      console.log("Feedback submitted:", parsed.data);
      setSubmitted(true);
      setTimeout(() => {
        onClose();
      }, 1500);
    },
  });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: "16px",
          maxWidth: "460px",
          width: "100%",
          padding: "1.5rem",
          boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 style={{ fontFamily: "Outfit, sans-serif", fontSize: "1.2rem", fontWeight: 700 }}>
            💡 Ønsk en rett / Tilbakemelding
          </h3>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.2rem",
              cursor: "pointer",
              color: "#a09890",
            }}
          >
            ✕
          </button>
        </div>

        {submitted ? (
          <div style={{ textAlign: "center", padding: "2rem 0", color: "#4a9e55", fontWeight: 600 }}>
            ✓ Takk for tilbakemeldingen!
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <form.Field
              name="canteen"
              children={(field) => (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#6b6158" }}>Kantine</label>
                  <select
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid #ece4d8",
                      fontFamily: "Outfit, sans-serif",
                    }}
                  >
                    <option value="Fresh4you">Fresh4you (Telenor Expo)</option>
                    <option value="Eat the street">Eat the street (The Hub)</option>
                    <option value="Flow">Flow (Bygg M)</option>
                  </select>
                </div>
              )}
            />

            <form.Field
              name="dishRequest"
              children={(field) => (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#6b6158" }}>Hvilken rett ønsker du deg?</label>
                  <input
                    type="text"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="f.eks. Pad Thai, Kylling Tikka Masala..."
                    style={{
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid #ece4d8",
                      fontFamily: "Outfit, sans-serif",
                    }}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <span style={{ fontSize: "0.75rem", color: "#d9604a" }}>
                      {field.state.meta.errors.join(", ")}
                    </span>
                  )}
                </div>
              )}
            />

            <form.Field
              name="comments"
              children={(field) => (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#6b6158" }}>Kommentarer (valgfritt)</label>
                  <textarea
                    rows={3}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Andre ønsker eller ris/ros..."
                    style={{
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid #ece4d8",
                      fontFamily: "Outfit, sans-serif",
                      resize: "none",
                    }}
                  />
                </div>
              )}
            />

            <button
              type="submit"
              style={{
                background: "#c8741a",
                color: "#ffffff",
                fontWeight: 700,
                padding: "10px",
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                marginTop: "0.5rem",
              }}
            >
              Send ønske
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
