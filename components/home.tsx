"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Box,
  ChevronRight,
  DraftingCompass,
  Scan,
  ScanLine,
  UsersRound,
  X,
} from "lucide-react";
import { Brand } from "./brand";
import { AuthDialog } from "./auth-dialog";
import { authModalHref, type AuthMode } from "@/lib/auth-navigation";

const features = [
  {
    title: "Parametric drafting",
    text: "Precise walls, openings, and dimensions.",
    icon: DraftingCompass,
    detail:
      "Draw walls with adjustable thickness in Studio. Use the snap grid and Ortho to align the drawing in millimeters or inches.",
  },
  {
    title: "Isometric views",
    text: "A new perspective on the same space.",
    icon: Box,
    detail:
      "Switch between the 2D plan and isometric preview in Studio. The dashboard also includes the furnished Courtyard House sample.",
  },
  {
    title: "Human + AI",
    text: "A shared language for spatial design.",
    icon: UsersRound,
    detail:
      "The MCP integration is planned for milestone 4. It will let agents work with the same floorplan graph as the studio.",
  },
  {
    title: "Spatial checks",
    text: "Clearances, circulation, and accessibility.",
    icon: ScanLine,
    detail:
      "Open Clearance in Studio to review obstructed door swings, narrow gaps and overlapping fixtures.",
  },
];
export function Home({
  signedIn,
  authConfigured,
  authMode,
  returnTo,
}: {
  signedIn: boolean;
  authConfigured: boolean;
  authMode: AuthMode | null;
  returnTo?: string;
}) {
  const [guideOpen, setGuideOpen] = useState(false);
  const [topic, setTopic] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (guideOpen && !dialog.current?.open) dialog.current?.showModal();
    if (!guideOpen && dialog.current?.open) dialog.current.close();
  }, [guideOpen]);
  const guide = (index = 0) => {
    setTopic(index);
    setGuideOpen(true);
  };
  return (
    <div className="page">
      <header className="header">
        <div className="header-inner">
          <Brand />
          <nav aria-label="Main">
            <button className="nav-active" onClick={() => setGuideOpen(false)}>
              Overview
            </button>
            <button onClick={() => guide()}>Field guide</button>
          </nav>
          <div className="header-actions">
            {signedIn ? (
              <Link className="dark-btn" href="/dashboard">
                Workspace <ArrowUpRight size={15} />
              </Link>
            ) : (
              <Link
                className="dark-btn"
                href={authModalHref("sign-in")}
                scroll={false}
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="home-main">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="orange-rule" /> COLLABORATIVE CAD STUDIO
            </div>
            <h1>
              Design space.
              <br />
              <em>Together.</em>
            </h1>
            <p>
              A parametric floorplan studio for humans and AI. Draw, furnish,
              and explore architectural spaces in one shared workspace.
            </p>
            <div className="hero-actions">
              {signedIn ? (
                <Link className="primary" href="/dashboard">
                  Open workspace <ArrowRight size={17} />
                </Link>
              ) : (
                <Link
                  className="primary"
                  href={authModalHref("sign-up")}
                  scroll={false}
                >
                  Create account <ArrowRight size={17} />
                </Link>
              )}
              <button className="guide-link" onClick={() => guide()}>
                <BookOpen size={16} /> Field guide
              </button>
            </div>
          </div>
          <figure className="sheet home-study">
            <div className="sheet-bar">
              <span className="sheet-label">Axonometric drawing</span>
            </div>
            <div className="sheet-field grid-on">
              <div className="art-wrap">
                <img
                  className="model"
                  src="/isometric.webp"
                  width="1448"
                  height="1086"
                  alt="Cutaway of a furnished two-bedroom home around a planted courtyard"
                  fetchPriority="high"
                />
              </div>
            </div>
            <figcaption className="sheet-foot">
              <div>
                <Scan size={16} />
                <strong>Courtyard House</strong>
              </div>
              <span className="mono">RESIDENTIAL STUDY</span>
            </figcaption>
          </figure>
        </section>
        <section className="capabilities">
          <div className="section-heading">
            <span className="eyebrow">
              <span className="orange-rule" /> STUDIO TOOLKIT
            </span>
            <div className="hairline" />
          </div>
          <div className="feature-grid">
            {features.map(({ title, text, icon: Icon }, i) => (
              <button className="feature" key={title} onClick={() => guide(i)}>
                <div className="feature-icon">
                  <Icon size={23} strokeWidth={1.55} />
                </div>
                <div>
                  <h2>{title}</h2>
                  <p>{text}</p>
                </div>
                <ArrowUpRight className="feature-arrow" size={14} />
              </button>
            ))}
          </div>
        </section>
      </main>
      <AuthDialog
        mode={authMode}
        configured={authConfigured}
        returnTo={returnTo}
      />
      <dialog
        ref={dialog}
        onClose={() => setGuideOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setGuideOpen(false);
        }}
        className="modal"
        aria-labelledby="field-guide-title"
      >
        <div className="modal-inner">
          <div className="modal-title">
            <span className="eyebrow">
              <span className="orange-rule" />
              STUDIO FIELD GUIDE
            </span>
            <button
              className="icon-btn"
              aria-label="Close dialog"
              onClick={() => setGuideOpen(false)}
            >
              <X size={19} />
            </button>
          </div>
          <h2 id="field-guide-title">Field guide</h2>
          <div className="guide-body">
            <div className="guide-topics">
              {features.map((f, i) => (
                <button
                  key={f.title}
                  aria-pressed={topic === i}
                  onClick={() => setTopic(i)}
                >
                  {f.title}
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
            <article>
              <span className="eyebrow">
                {topic === 1 ? "SAMPLE WORKSPACE" : "STUDIO ROADMAP"}
              </span>
              <h3>{features[topic].title}</h3>
              <p>{features[topic].detail}</p>
            </article>
          </div>
        </div>
      </dialog>
    </div>
  );
}
