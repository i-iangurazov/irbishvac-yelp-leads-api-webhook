const envVars = [
  "YELP_CLIENT_ID",
  "YELP_CLIENT_SECRET",
  "YELP_API_KEY",
  "YELP_REDIRECT_URI",
  "YELP_ALLOWED_BUSINESS_IDS",
] as const;

const testCommands = [
  'curl "http://localhost:3000/api/yelp/webhook?verification=test123"',
  `curl --request POST \\
  --url http://localhost:3000/api/yelp/webhook \\
  --header 'content-type: application/json' \\
  --data '{
    "time": "2026-03-17T15:00:00+00:00",
    "object": "business",
    "data": {
      "id": "1T1qXHt8mdTiXkPUpKn21A",
      "updates": [
        {
          "event_type": "NEW_EVENT",
          "event_id": "evt_test_001",
          "lead_id": "29HeLueoGE2vvD8tEVJYMQ",
          "interaction_time": "2026-03-17T15:00:00+00:00"
        }
      ]
    }
  }'`,
  'curl "http://localhost:3000/api/yelp/oauth/callback?code=TEST_CODE&state=test123"',
];

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "48px 20px",
      }}
    >
      <section
        style={{
          width: "min(920px, 100%)",
          background: "var(--surface)",
          border: "1px solid var(--surface-border)",
          boxShadow: "var(--shadow)",
          borderRadius: 28,
          padding: "32px 28px",
          backdropFilter: "blur(18px)",
        }}
      >
        <p
          style={{
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            fontSize: 12,
            color: "var(--accent-strong)",
          }}
        >
          Yelp Leads Backend
        </p>
        <h1
          style={{
            margin: "12px 0 8px",
            fontSize: "clamp(2.2rem, 5vw, 4.25rem)",
            lineHeight: 1,
            maxWidth: 680,
          }}
        >
          OAuth, webhook intake, token refresh, and lead normalization.
        </h1>
        <p
          style={{
            margin: "0 0 24px",
            color: "var(--muted)",
            fontSize: 18,
            lineHeight: 1.6,
            maxWidth: 720,
          }}
        >
          This app is intentionally backend-first. Configure the environment, run
          the local server, complete Yelp OAuth once, then use the webhook and
          callback routes below.
        </p>

        <div
          style={{
            display: "grid",
            gap: 20,
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            marginBottom: 24,
          }}
        >
          <article
            style={{
              padding: 20,
              borderRadius: 20,
              background: "rgba(255, 255, 255, 0.84)",
              border: "1px solid var(--surface-border)",
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: 20 }}>Start It</h2>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
{`pnpm install
pnpm dev`}
            </pre>
          </article>

          <article
            style={{
              padding: 20,
              borderRadius: 20,
              background: "rgba(255, 255, 255, 0.84)",
              border: "1px solid var(--surface-border)",
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: 20 }}>Routes</h2>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
{`GET  /api/yelp/webhook?verification=abc
POST /api/yelp/webhook
GET  /api/yelp/oauth/callback?code=...&state=...`}
            </pre>
          </article>
        </div>

        <article
          style={{
            padding: 20,
            borderRadius: 20,
            background: "rgba(24, 32, 36, 0.96)",
            color: "#f7f4ef",
            marginBottom: 24,
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: 20 }}>Required Env</h2>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              fontSize: 14,
              lineHeight: 1.75,
            }}
          >
            {envVars.join("\n")}
          </pre>
        </article>

        <article
          style={{
            padding: 20,
            borderRadius: 20,
            background: "rgba(255, 255, 255, 0.84)",
            border: "1px solid var(--surface-border)",
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: 20 }}>Local Tests</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {testCommands.map((command) => (
              <pre
                key={command}
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  fontSize: 14,
                  lineHeight: 1.6,
                  padding: 16,
                  borderRadius: 16,
                  background: "#fff",
                  border: "1px solid var(--surface-border)",
                  overflowX: "auto",
                }}
              >
                {command}
              </pre>
            ))}
          </div>
          <p style={{ marginBottom: 0, marginTop: 16, color: "var(--muted)" }}>
            Full setup, production notes, and the exact production curl commands
            are in <code>docs/yelp-integration.md</code>.
          </p>
        </article>
      </section>
    </main>
  );
}
