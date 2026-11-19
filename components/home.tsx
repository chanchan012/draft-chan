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
  ScanLine,
  UsersRound,
  X,
} from "lucide-react";
import { Brand } from "./brand";
import { Sheet } from "./sheet";

const features = [
  {
    title: "Parametric drafting",
    text: "Precise walls, openings, and dimensions.",
    icon: DraftingCompass,
    detail:
      "The planned wall tool uses millimeter coordinates, thickness parameters, and angle snapping. Display units can switch between millimeters and inches.",
  },
  {
    title: "Isometric views",
    text: "A new perspective on the same space.",
    icon: Box,
    detail:
      "Use the view switch in the sample workspace to compare an illustrative floor plan with a furnished architectural cutaway.",
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
      "The clearance engine is planned for milestone 3. It will report door-swing conflicts and narrow pathways for design review.",
  },
];
type Overlay = "sample" | "guide" | null;
export function Home() {
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [topic, setTopic] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (new URLSearchParams(location.search).get("view") === "sample")
      setOverlay("sample");
  }, []);
  useEffect(() => {
    if (overlay && !dialog.current?.open) dialog.current?.showModal();
    if (!overlay && dialog.current?.open) dialog.current?.close();
  }, [overlay]);
  const guide = (index = 0) => {
    setTopic(index);
    setOverlay("guide");
  };
  return (
    <div className="page">
      <header className="header">
        <div className="header-inner">
          <Brand />
          <nav aria-label="Main">
            <button className="nav-active" onClick={() => setOverlay(null)}>
              Overview
            </button>
            <button onClick={() => setOverlay("sample")}>Sample plan</button>
            <button onClick={() => guide()}>Field guide</button>
          </nav>
          <div className="header-actions">
            <Link className="login" href="/sign-in">
              Sign in
            </Link>
            <Link className="dark-btn" href="/dashboard">
              Workspace <ArrowUpRight size={15} />
            </Link>
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
              <button className="primary" onClick={() => setOverlay("sample")}>
                Explore demo <ArrowRight size={17} />
              </button>
              <button className="guide-link" onClick={() => guide()}>
                <BookOpen size={16} /> Field guide
              </button>
            </div>
            <div className="hero-note mono">
              <span className="signal" /> GUEST ACCESS <b>·</b> NO SIGN-UP
              REQUIRED
            </div>
          </div>
          <Sheet onExpand={() => setOverlay("sample")} />
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
      <footer className="footer">
        <div>
          <span className="footer-mark">⌖</span> DRAFT SYSTEMS{" "}
          <span className="foot-divider">/</span> <span>V0.1</span>
        </div>
        <span className="foot-status">
          <span className="signal" /> GUEST DEMO ONLINE
        </span>
      </footer>
      <dialog
        ref={dialog}
        onClose={() => setOverlay(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOverlay(null);
        }}
        className={"modal " + (overlay === "sample" ? "sample-modal" : "")}
      >
        <div className="modal-inner">
          <div className="modal-title">
            <span className="eyebrow">
              <span className="orange-rule" />
              {overlay === "sample" ? "GUEST DEMO" : "STUDIO FIELD GUIDE"}
            </span>
            <button
              className="icon-btn"
              aria-label="Close dialog"
              onClick={() => setOverlay(null)}
            >
              <X size={19} />
            </button>
          </div>
          {overlay === "sample" ? (
            <>
              <h2>Sample plan</h2>
              <Sheet expanded />
            </>
          ) : (
            <>
              <h2>Field guide</h2>
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
                  <button
                    className="text-action"
                    onClick={() => setOverlay("sample")}
                  >
                    Open sample plan <ArrowRight size={15} />
                  </button>
                </article>
              </div>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
