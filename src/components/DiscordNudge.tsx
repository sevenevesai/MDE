import { useEffect, useState } from "react";
import { claimNudge, DISCORD_NUDGE_URL, NUDGE_TIMEOUT_MS, openDiscord } from "../discordNudge";

// StrictMode mounts twice in dev; the launch must be counted once per page load.
let claimed: boolean | undefined;
function claimOnce(): boolean {
  if (claimed === undefined) {
    try {
      claimed = claimNudge(localStorage);
    } catch {
      claimed = false;
    }
  }
  return claimed;
}

interface DiscordNudgeProps {
  onError: (text: string) => void;
}

export default function DiscordNudge({ onError }: DiscordNudgeProps) {
  const [visible, setVisible] = useState(claimOnce);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), NUDGE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  const join = () => {
    setVisible(false);
    openDiscord(DISCORD_NUDGE_URL).catch(() => onError("Could not open the Discord link."));
  };

  return (
    <div
      role="complementary"
      aria-label="Discord"
      className="fixed bottom-10 left-4 z-40 max-w-xs px-4 py-2.5 rounded border border-border bg-bg-secondary text-xs text-text-primary shadow-lg flex items-start gap-3"
    >
      <span className="flex-1">Found a bug or want a feature? Tell me on Discord.</span>
      <button onClick={join} className="shrink-0 font-medium text-accent hover:underline">
        Join
      </button>
      <button
        onClick={() => setVisible(false)}
        aria-label="Close"
        className="text-text-muted hover:text-text-primary shrink-0"
      >
        ×
      </button>
    </div>
  );
}
