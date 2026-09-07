"use client";

import { createPortal } from "react-dom";

/**
 * The "about this app" panel.
 *
 * Lazy, like every other overlay here. It was the last one rendering inline in
 * HomeClient, which cost the first paint ~80 lines of static JSX and two inline
 * SVGs for a panel almost nobody opens — and kept its stylesheet in the
 * render-blocking bundle with it.
 *
 * Portalled to document.body, and it has to be: HomeClient marks `.app-wrapper`
 * inert while this is open, and an overlay rendered inside that subtree is made
 * unreachable by the very attribute meant to protect the page behind it.
 *
 * The entrance is CSS (`overlayFadeIn` / `modalPanelIn`); it closes instantly,
 * as the lightbox and week overview already did. Its rules stay in globals.css:
 * moving them would save about a kilobyte gzipped and means cutting blocks out
 * of shared media queries, which nothing in the test suite would catch.
 */
export default function InfoModal({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div
      className="info-overlay"
      role="presentation"
      onClick={() => onClose()}
    >
      <div
        className="info-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="info-title-id"
        onClick={e => e.stopPropagation()}
      >
        <button className="info-close" onClick={() => onClose()} aria-label="Lukk">&times;</button>
        <div className="info-header">
          <h2 id="info-title-id" className="info-title">{"Dagens"} <span>{"Lunsj"}</span></h2>
          <p className="info-tagline">{"Din daglige lunsjfølgesvenn på Fornebu"}</p>
        </div>
        <div className="info-body">
          <p className="info-intro">
            {"En alt-i-ett lunsjapp som henter ferske menyer fra kantinene på Telenor Fornebu hver uke. Se hva som serveres, stem på favorittlunsjen din, og oppdag nye oppskrifter — alt på ett sted."}
          </p>
          <div className="info-features">
            <div className="info-feature">
              <span className="info-feature-icon">&#x1F37D;&#xFE0F;</span>
              <div>
                <strong>{"Daglige menyer"}</strong>
                <span>{"Tre kantiner, fem dager, komplett med allergener og bilder generert av AI."}</span>
              </div>
            </div>
            <div className="info-feature">
              <span className="info-feature-icon">&#x1F5F3;&#xFE0F;</span>
              <div>
                <strong>{"Stem i dag"}</strong>
                <span>{"Se hvilken kantine kollegene dine velger. Stemmetall oppdateres i sanntid."}</span>
              </div>
            </div>
            <div className="info-feature">
              <span className="info-feature-icon">&#x1F468;&#x200D;&#x1F373;</span>
              <div>
                <strong>{"AI-oppskrifter"}</strong>
                <span>{"Liker du retten? Få en komplett oppskrift med ingredienser, steg og koketips, laget av AI."}</span>
              </div>
            </div>
            <div className="info-feature">
              <span className="info-feature-icon">&#x1F6D2;</span>
              <div>
                <strong>{"Handle smart"}</strong>
                <span>{"Finn de billigste ingrediensene på tvers av norske dagligvarebutikker, eller bygg en handleliste på MENY."}</span>
              </div>
            </div>
            <div className="info-feature">
              <span className="info-feature-icon">&#x1F310;</span>
              <div>
                <strong>{"Tospråklig"}</strong>
                <span>{"Full norsk og engelsk støtte — bytt med en knapp."}</span>
              </div>
            </div>
          </div>
          <div className="info-tech">
            <p className="info-tech-label">{"Bygget med"}</p>
            <p className="info-tech-stack">Next.js &middot; React 19 &middot; Gemini AI &middot; Upstash Redis &middot; Vercel</p>
          </div>
        </div>
        <div className="info-footer">
          <span className="info-made-by">{"Laget av"} Tom Hoel</span>
          <div className="info-footer-links">
            <a href="mailto:tom.chamkrai.hoel@telenor.no?subject=Feedback%20on%20Canteen%20App" className="info-footer-link">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
              {"Tilbakemelding"}
            </a>
            <a href="https://www.linkedin.com/in/tom-hoel-47923215b/" target="_blank" rel="noopener noreferrer" className="info-footer-link info-linkedin">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
              LinkedIn
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
