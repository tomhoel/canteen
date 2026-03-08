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
  if (!isOpen) return null;

  return (
    <div className="vote-modal-overlay" onClick={onClose}>
      <div className="vote-modal" onClick={e => e.stopPropagation()}>
        <h3 className="vote-modal-title">{canteenName}</h3>
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
              {isVoting ? "..." : (lang === "no" ? "Jeg stemmer p\u00E5 denne! \uD83D\uDE4B" : "I vote for this! \uD83D\uDE4B")}
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
      </div>
    </div>
  );
}
