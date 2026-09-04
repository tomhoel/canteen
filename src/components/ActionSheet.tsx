"use client";

import { useState, useRef, useEffect } from "react";
import { ChefHat, ChevronRight, Check } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { getCanteenMetadata } from "@/lib/constants";

export interface ActionSheetProps {
  isOpen: boolean;
  canteenName: string;
  dishName: string;
  imagePath: string;
  description: string | null;
  canVote: boolean;
  hasVoted: boolean;
  isVoting: boolean;
  votedCanteen: string;
  voteSuccess: boolean;
  onVote: (canteenName: string) => Promise<void>;
  onRecipeClick: (dishName: string, canteenName: string) => void;
  onClose: () => void;
  shareButton?: React.ReactNode;
}

export default function ActionSheet({
  isOpen,
  canteenName,
  dishName,
  imagePath,
  description,
  canVote,
  hasVoted,
  isVoting,
  votedCanteen,
  voteSuccess,
  onVote,
  onRecipeClick,
  onClose,
  shareButton,
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
          {description && <p className="action-sheet-desc">{description}</p>}
        </div>

        {/* Actions */}
        {voteSuccess ? (
          <div className="action-sheet-success">
            <div className="vote-celebration">
              <span className="celebration-emoji celebration-1">&#x1F389;</span>
              <span className="celebration-emoji celebration-2">&#x2B50;</span>
              <span className="celebration-emoji celebration-3">&#x1F38A;</span>
              <span className="celebration-emoji celebration-4">&#x2728;</span>
              <span className="celebration-emoji celebration-5">&#x1F973;</span>
            </div>
            <div className="vote-success-check">
              <Check size={28} strokeWidth={3} />
            </div>
            <span className="vote-success-text">
              {"Takk for stemmen!"}
            </span>
            <span className="vote-success-sub">{canteenName}</span>
            {shareButton}
          </div>
        ) : (
          <div className="action-sheet-actions">
            {canVote && (
              <button
                type="button"
                className={`action-sheet-btn action-sheet-vote${hasVoted ? " voted" : ""}${isVoting ? " voting" : ""}`}
                disabled={hasVoted || isVoting}
                onClick={async () => {
                  await onVote(canteenName);
                }}
              >
                <div className="action-sheet-btn-icon-wrap action-sheet-icon-vote">
                  {isVoting ? "⏳" : hasVoted ? "✔" : "🗳️"}
                </div>
                <div className="action-sheet-btn-text">
                  <span className="action-sheet-btn-label">
                    {isVoting
                      ? "Stemmer..."
                      : hasVoted
                      ? "Allerede stemt"
                      : "Stem på denne"}
                  </span>
                  <span className="action-sheet-btn-sub">
                    {hasVoted
                      ? `Du stemte på ${votedCanteen}`
                      : "Vis at du spiser her i dag"}
                  </span>
                </div>
                {!hasVoted && !isVoting && (
                  <ChevronRight size={18} className="action-sheet-btn-arrow" />
                )}
              </button>
            )}

            <button
              type="button"
              className="action-sheet-btn action-sheet-recipe"
              onClick={() => {
                onClose();
                onRecipeClick(dishName, canteenName);
              }}
            >
              <div className="action-sheet-btn-icon-wrap action-sheet-icon-recipe">
                <ChefHat size={18} />
              </div>
              <div className="action-sheet-btn-text">
                <span className="action-sheet-btn-label">
                  {"Lag hjemme"}
                </span>
                <span className="action-sheet-btn-sub">
                  {"Få AI-generert oppskrift"}
                </span>
              </div>
              <ChevronRight size={18} className="action-sheet-btn-arrow" />
            </button>

            {canVote && shareButton}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
