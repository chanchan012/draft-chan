import Link from "next/link";
import { SignIn, SignUp } from "@clerk/nextjs";
import { ArrowLeft, ArrowRight, KeyRound } from "lucide-react";
import { Brand } from "./brand";
import { clerkEnabled } from "@/lib/server/auth";
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
      <main className="auth-main">
        <div className="auth-panel">
          <span className="eyebrow">
            <span className="orange-rule" /> STUDIO ACCESS
          </span>
          {clerkEnabled() ? (
            signup ? (
              <SignUp routing="path" path="/sign-up" />
            ) : (
              <SignIn routing="path" path="/sign-in" />
            )
          ) : (
            <>
              <KeyRound className="auth-key" size={25} />
              <h1>{signup ? "Open your studio." : "Welcome back."}</h1>
              <p>
                This workspace is in guest demo mode. Explore the Courtyard
                House sample without an account.
              </p>
              <Link href="/?view=sample" className="primary">
                Continue as guest <ArrowRight size={16} />
              </Link>
            </>
          )}
        </div>
      </main>
      <footer className="footer">
        <div>DRAFT SYSTEMS / V0.1</div>
        <span className="foot-status">
          <span className="signal" /> GUEST DEMO ONLINE
        </span>
      </footer>
    </div>
  );
}
