import { Button } from "@/components/ui/button";
import Link from "next/link";
import { EyeTracker } from "./eye-tracker";

const CTA_ID = "subprompt-cta";
const CARD_ID = "subprompt-card";

export function SubscriptionPrompt() {
  return (
    <>
      <article
        id={CARD_ID}
        className="subprompt-card relative mx-auto mt-4 w-full max-w-[620px] animate-in fade-in-50 duration-500 sm:mt-6"
        aria-labelledby="nosubTitle"
      >
        <span
          className="subprompt-pill"
          aria-label="Status: subscription required"
        >
          <span className="subprompt-dot" aria-hidden="true" />
          Subscription required
        </span>

        <header className="subprompt-header">
          <h2 className="subprompt-title" id="nosubTitle">
            You can&apos;t post just yet
          </h2>
          <p className="subprompt-sub">
            You need to subscribe to create and schedule posts.
          </p>
        </header>

        <section
          className="subprompt-panel"
          aria-label="What you get with a subscription"
        >
          <p className="subprompt-eyebrow">Subscribe to…</p>
          <ul className="subprompt-perks" role="list">
            {[
              {
                title: "Create and schedule unlimited posts",
                sub: "Never worry about content limits again.",
              },
              {
                title: "Connect multiple social accounts",
                sub: "Manage all your platforms in one place.",
              },
              {
                title: "Access all premium features",
                sub: "Increased storage, post speed and priority support.",
              },
            ].map((perk) => (
              <li key={perk.title} className="subprompt-perk">
                <span className="subprompt-check" aria-hidden="true">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3.5 8.5l3 3 6-7" />
                  </svg>
                </span>
                <div>
                  <p className="subprompt-perk-title">{perk.title}</p>
                  <p className="subprompt-perk-sub">{perk.sub}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <footer className="subprompt-footer">
          <EyeTracker cardId={CARD_ID} ctaId={CTA_ID} />

          <div className="subprompt-actions">
            <div className="subprompt-cta-wrap">
              <Button asChild className="subprompt-cta" id={CTA_ID}>
                <Link href="/#pricing">
                  <span>Subscribe now</span>
                </Link>
              </Button>
            </div>

            <Link href="/#pricing" className="subprompt-ghost">
              View pricing details{" "}
              <span className="subprompt-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          </div>
        </footer>
      </article>

      <SubscriptionPromptStyles />
    </>
  );
}

/* Static styles split out for clarity; server-rendered via dangerouslySetInnerHTML
   so they ship in the initial HTML with zero hydration cost. */
function SubscriptionPromptStyles() {
  return <style dangerouslySetInnerHTML={{ __html: SUBPROMPT_CSS }} />;
}

const SUBPROMPT_CSS = `
.subprompt-card{--eye:64px;--pupil:26px;--pad:32px;--pad-b:26px;--radius:24px;--title:28px;--sub:15px;background:#fff;border-radius:var(--radius);padding:var(--pad) var(--pad) var(--pad-b);color:#1a1815;font-feature-settings:"ss01","cv11";-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 1px 2px rgba(26,24,21,.04),0 20px 44px -24px rgba(26,24,21,.18)}
.subprompt-pill{position:absolute;top:18px;right:18px;display:inline-flex;align-items:center;gap:8px;height:26px;padding:0 11px 0 10px;border-radius:999px;background:#ffe9e1;color:#c73e1f;font-size:11.5px;font-weight:600;letter-spacing:.04em;white-space:nowrap;box-shadow:inset 0 0 0 1px rgba(199,62,31,.1),0 1px 2px rgba(199,62,31,.08)}
.subprompt-dot{position:relative;width:6px;height:6px;border-radius:50%;background:#ff5a36;box-shadow:0 0 0 0 rgba(255,90,54,.45);animation:subprompt-pulse 1.8s ease-out infinite}
@keyframes subprompt-pulse{0%{box-shadow:0 0 0 0 rgba(255,90,54,.45)}70%{box-shadow:0 0 0 8px rgba(255,90,54,0)}100%{box-shadow:0 0 0 0 rgba(255,90,54,0)}}
.subprompt-header{padding-right:170px;margin-bottom:22px}
.subprompt-title{font-size:var(--title);line-height:1.1;font-weight:700;letter-spacing:-.025em;color:#1a1815;margin:6px 0 8px;text-wrap:balance}
.subprompt-sub{font-size:var(--sub);line-height:1.55;color:#4a4640;margin:0;max-width:46ch;text-wrap:pretty}
.subprompt-panel{position:relative;background:#f8f5ec;border-radius:16px;padding:20px 20px 18px;box-shadow:inset 0 1px 0 rgba(255,255,255,.9),inset 0 0 0 1px rgba(230,224,208,.7);overflow:hidden}
.subprompt-panel::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.55) 0,rgba(255,255,255,0) 38%);pointer-events:none}
.subprompt-eyebrow{position:relative;font-size:11.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#8e887b;margin:0 0 14px}
.subprompt-perks{position:relative;display:grid;gap:14px;list-style:none;padding:0;margin:0}
.subprompt-perk{display:grid;grid-template-columns:26px 1fr;gap:12px;align-items:start}
.subprompt-check{width:26px;height:26px;border-radius:50%;background:#e0f0e6;color:#2f8f5a;display:inline-flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px rgba(47,143,90,.1);flex:none}
.subprompt-perk-title{font-size:14.5px;font-weight:600;color:#1a1815;line-height:1.3;letter-spacing:-.005em;margin:2px 0}
.subprompt-perk-sub{font-size:13px;line-height:1.45;color:#8e887b;margin:0;text-wrap:pretty}
.subprompt-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:22px}
.subprompt-actions{display:flex;align-items:center;gap:14px}
.subprompt-cta-wrap{display:inline-flex}
.subprompt-cta{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:9px;padding:12px 22px;height:auto;background:#1a1815;color:#fff;border:0;border-radius:12px;font-size:14.5px;font-weight:600;letter-spacing:-.005em;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;box-shadow:0 1px 0 rgba(255,255,255,.06) inset,0 1px 2px rgba(26,24,21,.18),0 6px 14px -8px rgba(26,24,21,.45);transition:transform .18s ease,box-shadow .18s ease,background-color .18s ease}
.subprompt-cta:hover{background:#2a2826;transform:translateY(-1px);box-shadow:0 1px 0 rgba(255,255,255,.08) inset,0 2px 4px rgba(26,24,21,.22),0 14px 24px -12px rgba(26,24,21,.55)}
.subprompt-cta:active{transform:translateY(0)}
.subprompt-spark{position:relative;width:16px;height:16px;color:#ffd9cc;display:inline-flex;flex:none;transition:transform .5s cubic-bezier(.4,0,.2,1)}
.subprompt-spark-2{position:absolute;inset:0;opacity:0;transform:scale(.55) rotate(45deg) translate(2px,-2px);transition:opacity .35s ease,transform .35s ease}
.subprompt-cta:hover .subprompt-spark{transform:rotate(80deg)}
.subprompt-cta:hover .subprompt-spark-2{opacity:1;transform:scale(.6) rotate(45deg) translate(3px,-3px)}
.subprompt-ghost{color:#8e887b;text-decoration:none;font-size:13.5px;font-weight:500;display:inline-flex;align-items:center;gap:4px;border-radius:6px;padding:8px 4px;transition:color .15s ease;-webkit-tap-highlight-color:transparent}
.subprompt-arrow{display:inline-block;transition:transform .18s ease}
.subprompt-ghost:hover{color:#4a4640}
.subprompt-ghost:hover .subprompt-arrow{transform:translateX(2px)}
.subprompt-eyes{position:relative;display:flex;align-items:center;gap:10px;padding:6px 8px}
.subprompt-eyes::before{content:"";position:absolute;inset:-14px -10px;background:radial-gradient(closest-side,rgba(255,90,54,.1),rgba(255,90,54,0) 75%);pointer-events:none;z-index:0}
.subprompt-eye{position:relative;z-index:1;width:var(--eye);height:var(--eye);flex:none;border-radius:50%;border:1.5px solid #1a1815;background:radial-gradient(circle at 50% 45%,#fff 0,#faf6e8 55%,#ede4ca 100%);box-shadow:inset 0 -6px 11px rgba(0,0,0,.06),inset 0 4px 6px rgba(255,255,255,.95),0 5px 12px rgba(26,24,21,.14);overflow:hidden}
.subprompt-pupil{position:absolute;top:50%;left:50%;width:var(--pupil);height:var(--pupil);margin:calc(var(--pupil) / -2) 0 0 calc(var(--pupil) / -2);border-radius:50%;background:radial-gradient(circle at 36% 32%,#2a2826 0,#0a0a09 75%);will-change:transform;transform:translate3d(0,0,0)}
.subprompt-pupil-inner{position:absolute;inset:0;border-radius:50%;background:inherit;will-change:transform;transform:scale(1)}
.subprompt-pupil::before{content:"";position:absolute;width:31%;height:31%;top:15%;left:15%;border-radius:50%;background:rgba(255,255,255,.95);box-shadow:0 0 6px rgba(255,255,255,.6)}
.subprompt-pupil::after{content:"";position:absolute;width:15%;height:15%;bottom:19%;right:19%;border-radius:50%;background:rgba(255,255,255,.75)}
.subprompt-lid{position:absolute;inset:0;background:radial-gradient(circle at 50% 45%,#fff 0,#faf6e8 55%,#ede4ca 100%);border-bottom:1.5px solid #1a1815;border-radius:50%;transform-origin:top center;transform:scaleY(0);pointer-events:none}
.subprompt-lid.blink{animation:subprompt-blink 160ms ease-in-out forwards}
@keyframes subprompt-blink{0%{transform:scaleY(0)}50%{transform:scaleY(1)}100%{transform:scaleY(0)}}
@media (max-width:640px){.subprompt-card{--pad:22px;--pad-b:20px;--radius:20px;--title:23px;--sub:14.5px;--eye:52px;--pupil:21px;margin-left:16px;margin-right:16px;width:auto;box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 1px 3px rgba(26,24,21,.06),0 10px 24px -14px rgba(26,24,21,.22)}.subprompt-pill{top:16px;left:16px;right:auto}.subprompt-header{padding-right:0;padding-top:32px;margin-bottom:18px}.subprompt-panel{padding:18px 16px 16px;border-radius:14px}.subprompt-perk-title{font-size:14px}.subprompt-perk-sub{font-size:12.5px}.subprompt-footer{flex-direction:column;align-items:stretch;gap:16px;margin-top:20px}.subprompt-eyes{justify-content:center;align-self:center;gap:8px}.subprompt-actions{flex-direction:column;align-items:stretch;gap:8px;width:100%}.subprompt-cta-wrap{width:100%}.subprompt-cta{width:100%;padding:14px 22px;font-size:15px}.subprompt-cta:hover{transform:none}.subprompt-ghost{justify-content:center;padding:10px 4px}}
@media (max-width:360px){.subprompt-card{--pad:18px;--title:21px;--eye:46px;--pupil:19px}.subprompt-perk{grid-template-columns:22px 1fr;gap:10px}.subprompt-check{width:22px;height:22px}}
@media (prefers-reduced-motion:reduce){.subprompt-dot{animation:none;box-shadow:0 0 0 3px rgba(255,90,54,.18)}.subprompt-lid{display:none}.subprompt-cta:hover{transform:none}.subprompt-spark,.subprompt-spark-2,.subprompt-pupil,.subprompt-pupil-inner{transition:none}}
`;
