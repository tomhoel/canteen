import { useEffect } from "react";
import { motion } from "motion/react";

interface VoteModalProps {
  isOpen: boolean;
  canteenName: string;
  hasVoted: boolean;
  votedCanteen: string;
  canteenNames: string[];
  votes: Record<string, number>;
  maxVotes: number;
  lang: "no" | "en";
  isVoting: boolean;
  onVote: (canteenName: string) => void;
  onClose: () => void;
}

export default function VoteModal({
  isOpen,
  canteenName,
  hasVoted,
  votedCanteen,
  canteenNames,
  votes,
  maxVotes,
  lang,
  isVoting,
  onVote,
  onClose,
}: VoteModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <motion.div
      className="vote-modal-overlay"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
    >
      <motion.div
        className="vote-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vote-modal-title-id"
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ type: "spring", damping: 25, stiffness: 320 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="vote-modal-title-id" className="vote-modal-title">{canteenName}</h3>
        {!hasVoted ? (
          <>
            <p className="vote-modal-subtitle">
              {lang === "no" ? "Skal du dit i dag?" : "Are you going today?"}
            </p>
            <button
              className="vote-btn"
              disabled={isVoting}
              onClick={() => onVote(canteenName)}
            >
              {isVoting ? "..." : (lang === "no" ? "Jeg stemmer på denne! 🙋" : "I vote for this! 🙋")}
            </button>
            <button className="vote-cancel" onClick={onClose}>
              {lang === "no" ? "Avbryt" : "Cancel"}
            </button>
          </>
        ) : (
          <>
            <p className="vote-modal-subtitle">
              {lang === "no" ? "Hvem spiser hvor i dag?" : "Who's going where today?"}
            </p>
            {canteenNames.map(name => (
              <div
                key={name}
                className={`vote-count-row${name === votedCanteen ? " voted" : ""}${(votes[name] ?? 0) > 0 && (votes[name] ?? 0) === maxVotes ? " leader" : ""}`}
              >
                <span>{name}</span>
                <span className="vote-count-number">{votes[name] ?? 0}</span>
              </div>
            ))}
            <button className="vote-cancel" onClick={onClose}>
              {lang === "no" ? "Lukk" : "Close"}
            </button>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
