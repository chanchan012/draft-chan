"use client";

import { SignIn, SignUp } from "@clerk/nextjs";
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { authModalHref, type AuthMode } from "@/lib/auth-navigation";
import "./auth-dialog.css";

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
    footer: { display: "none" },
    formFieldInput: "draft-clerk-input",
    formButtonPrimary: "draft-clerk-action",
    socialButtonsBlockButton: "draft-clerk-action",
  },
};

export function AuthDialog({
  mode,
  configured,
  returnTo,
}: {
  mode: AuthMode | null;
  configured: boolean;
  returnTo?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  useEffect(() => {
    const element = dialog.current;
    if (mode && !element?.open) element?.showModal();
    if (!mode && element?.open) element.close();
  }, [mode]);

  const signup = mode === "sign-up";
  const action = signup ? "Create account" : "Sign in";
  const target = returnTo ?? "/dashboard";
  return (
    <dialog
      ref={dialog}
      className="modal auth-dialog"
      aria-labelledby="auth-dialog-title"
      onClose={() => {
        if (mode && !dialog.current?.open)
          router.replace("/", { scroll: false });
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
    >
      <div className="auth-dialog-content">
        <div className="auth-dialog-heading">
          <h2 id="auth-dialog-title">{action}</h2>
          <button
            className="icon-btn"
            type="button"
            aria-label="Close authentication"
            onClick={() => dialog.current?.close()}
          >
            <X size={19} />
          </button>
        </div>
        {mode &&
          (configured ? (
            signup ? (
              <SignUp
                routing="hash"
                appearance={appearance}
                forceRedirectUrl={target}
                signInForceRedirectUrl={target}
              />
            ) : (
              <SignIn
                routing="hash"
                appearance={appearance}
                forceRedirectUrl={target}
                signUpForceRedirectUrl={target}
              />
            )
          ) : (
            <p className="auth-unavailable">
              Sign-in is temporarily unavailable. Please try again later.
            </p>
          ))}
        <div className="auth-switch">
          {signup ? "Already have an account?" : "New to Draft?"}
          <Link
            href={authModalHref(signup ? "sign-in" : "sign-up", returnTo)}
            scroll={false}
            replace
          >
            {signup ? "Sign in" : "Create account"}
          </Link>
        </div>
      </div>
    </dialog>
  );
}
