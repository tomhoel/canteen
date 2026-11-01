"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronRight, Check } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { getCanteenMetadata } from "@/lib/constants";

export interface ActionSheetProps {
  isOpen: boolean;
  canteenName: string;
  dishName: string;
  imagePath: string;
  canVote: boolean;
  hasVoted: boolean;
  isVoting: boolean;
  votedCanteen: string;
  voteSuccess: boolean;
  voteError: boolean;
  onVote: (canteenName: string) => Promise<void>;
  onClose: () => void;
}

export default function ActionSheet({
  isOpen,
  canteenName,
  dishName,
  imagePath,
  canVote,
  hasVoted,
  isVoting,
  votedCanteen,
  voteSuccess,
  voteError,
  onVote,
  onClose,
}: ActionSheetProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Reset image state when opened or dish changed
  useEffect(() => {
    if (isOpen) {
      setImageLoaded(false);
      setImageFailed(false);
    }
  }, [isOpen, imagePath]);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        aria-label={dishName || canteenName}
        showCloseButton={true}
        showHandle={true}
        onClose={onClose}
        className="action-sheet"
      >
        {/* Hero image */}
        <div className="action-sheet-hero">
          {imageFailed || !imagePath ? (
            <div className="image-placeholder">{canteenName.charAt(0)}</div>
          ) : (
            <img
              key={imagePath}
              ref={(el) => {
                imgRef.current = el;
                if (el?.complete && el.naturalWidth > 0) setImageLoaded(true);
              }}
              src={imagePath}
              alt={dishName}
              className={`action-sheet-img${imageLoaded ? " loaded" : ""}`}
              decoding="async"
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageFailed(true)}
            />
          )}
          <div className="action-sheet-hero-fade" />
        </div>

        {/* Header */}
        <div className="action-sheet-header">
          {(() => {
            const meta = getCanteenMetadata(canteenName);
            return (
              <div className="action-sheet-canteen">
                <span>{meta.name}</span>
                {meta.buildingCode && (
                  <span className="canteen-building-tag">{meta.buildingCode}</span>
                )}
              </div>
            );
          })()}
          <h3 className="action-sheet-dish">{dishName}</h3>
          {(() => {
            const meta = getCanteenMetadata(canteenName);
            const where = [meta.building, meta.floor].filter(Boolean).join(" · ");
            return (
              <p className="action-sheet-desc">
                {where}{where && meta.hours ? " · " : ""}{meta.hours}
              </p>
            );
          })()}
        </div>

        {/* Actions */}
        {voteSuccess ? (
          <div className="action-sheet-success" role="status">
            <div className="vote-success-check">
              <Check size={28} strokeWidth={3} />
            </div>
            <span className="vote-success-text">{"Takk for stemmen!"}</span>
            <span className="vote-success-sub">{canteenName}</span>
          </div>
        ) : canVote ? (
          <div className="action-sheet-actions">
            <button
              type="button"
              className={`action-sheet-btn action-sheet-vote${hasVoted ? " voted" : ""}${isVoting ? " voting" : ""}`}
              disabled={hasVoted || isVoting}
              onClick={async () => {
                await onVote(canteenName);
              }}
            >
              <div className="action-sheet-btn-icon-wrap action-sheet-icon-vote">
                <Check size={18} strokeWidth={2.6} />
              </div>
              <div className="action-sheet-btn-text">
                <span className="action-sheet-btn-label">
                  {isVoting ? "Stemmer..." : hasVoted ? "Allerede stemt" : "Stem på denne"}
                </span>
                <span className="action-sheet-btn-sub">
                  {voteError
                    ? "Stemmen ble ikke registrert. Prøv igjen."
                    : hasVoted
                    ? `Du stemte på ${votedCanteen}`
                    : "Vis at du spiser her i dag"}
                </span>
              </div>
              {!hasVoted && !isVoting && (
                <ChevronRight size={18} className="action-sheet-btn-arrow" />
              )}
            </button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
