/**
 * Onboarding interstitial — one-time "tour now or skip" banner for first-time
 * users. Decision is recorded server-side via POST /api/auth/welcome-seen
 * (which sets users.welcome_seen_at = NOW()). Skips on subsequent loads.
 *
 * "Take the tour" navigates to the Master Guide (`master-guide` view).
 * "Skip" just dismisses the modal. Both dismiss POST the welcome-seen flag.
 */
import { useUser } from "../auth/UserContext";

interface Props {
  onTakeTour: () => void;
}

export function OnboardingInterstitial({ onTakeTour }: Props) {
  const { user, markWelcomeSeen } = useUser();

  // Render nothing if user is loaded and already saw welcome, or if anonymous.
  if (!user) return null;
  if (user.welcome_seen_at) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 15, 17, 0.75)",
        backdropFilter: "blur(4px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        style={{
          background: "var(--riq-surface)",
          border: "1px solid var(--riq-accent)",
          borderRadius: 10,
          padding: 28,
          maxWidth: 480,
          width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--riq-accent)", marginBottom: 6, letterSpacing: "0.04em" }}>
          WELCOME TO RIQ 21
        </div>
        <h2 id="onboarding-title" style={{ fontSize: 24, fontWeight: 800, color: "var(--riq-text)", margin: 0, letterSpacing: "-0.01em" }}>
          Take the 2-minute tour?
        </h2>
        <p style={{ fontSize: 14, color: "var(--riq-text-muted)", lineHeight: 1.6, marginTop: 12 }}>
          The Master Guide walks you through what every section does and which pages matter for your role.
          You can always reach it later from the top of the sidebar.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button
            onClick={async () => {
              await markWelcomeSeen();
              onTakeTour();
            }}
            style={{
              background: "var(--riq-accent)",
              color: "#0c0c0e",
              border: "none",
              borderRadius: 6,
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              flex: 1,
            }}
          >
            📋 Take the tour
          </button>
          <button
            onClick={() => {
              void markWelcomeSeen();
            }}
            style={{
              background: "transparent",
              border: "1px solid var(--riq-border)",
              color: "var(--riq-text)",
              borderRadius: 6,
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
