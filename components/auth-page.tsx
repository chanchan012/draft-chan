import Link from "next/link";
import { SignIn, SignUp } from "@clerk/nextjs";
import { ArrowLeft } from "lucide-react";
import { clerkEnabled } from "@/lib/server/auth";
import { Brand } from "./brand";
import "./auth-page.css";

const appearance = {
  variables: {
    colorPrimary: "#a84023",
    colorBackground: "#faf9f6",
    colorText: "#252720",
    colorInputBackground: "#fffefa",
    fontFamily: "Inter, Arial, sans-serif",
    borderRadius: "6px",
  },
  elements: {
    rootBox: "draft-clerk-root",
    cardBox: "draft-clerk-card-box",
    card: "draft-clerk-card",
    header: "draft-clerk-header",
    footer: "draft-clerk-footer",
    formFieldInput: "draft-clerk-input",
    formButtonPrimary: "draft-clerk-action",
    socialButtonsBlockButton: "draft-clerk-action",
    footerActionLink: "draft-clerk-link",
  },
};

export function AuthPage({ signup = false }: { signup?: boolean }) {
  return (
    <div className="auth-page">
      <header className="header">
        <div className="header-inner">
          <Brand />
          <Link className="back" href="/">
            <ArrowLeft size={16} /> Overview
          </Link>
        </div>
      </header>
      <main className="auth-scroll">
        <div className="auth-layout">
          <section className="auth-panel" aria-labelledby="auth-title">
            <h1 id="auth-title">
              {signup ? "Start a drawing." : "Back to the drawing board."}
            </h1>
            {clerkEnabled() ? (
              signup ? (
                <SignUp routing="path" path="/sign-up" appearance={appearance} />
              ) : (
                <SignIn routing="path" path="/sign-in" appearance={appearance} />
              )
            ) : (
              <p className="auth-unavailable">
                Sign-in is temporarily unavailable. Please try again later.
              </p>
            )}
          </section>
          <figure className="auth-study">
            <div className="auth-study-art grid-on">
              <img
                src="/isometric.webp"
                width="1448"
                height="1086"
                alt=""
              />
            </div>
            <figcaption>
              <strong>Courtyard House</strong>
              <span>AXONOMETRIC STUDY</span>
            </figcaption>
          </figure>
        </div>
      </main>
    </div>
  );
}
