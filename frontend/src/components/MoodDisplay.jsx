// Shows the drift. Rando has always had a mood counter; until now it was
// invisible, so there was no way to tell whether it was steering on anything
// real. Genre tags are noisy on purpose here — seeing junk like "british" win
// is the point of putting it on screen.
export default function MoodDisplay({ mood, wildcard }) {
  if (!mood?.length) return null;

  return (
    <div className="mood-display">
      <span className="mood-label">Vibe</span>
      {wildcard && (
        <span className="mood-wild" title="Rando ignored the mood on this pick and jumped somewhere new">
          WILD
        </span>
      )}
      <div className="mood-bars">
        {mood.map(({ genre, weight }) => (
          <span
            key={genre}
            className="mood-chip"
            title={`${genre} — ${Math.round(weight * 100)}% of the strongest`}
          >
            <span
              className="mood-chip-fill"
              style={{ width: `${Math.max(4, weight * 100)}%` }}
            />
            <span className="mood-chip-text">{genre}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
