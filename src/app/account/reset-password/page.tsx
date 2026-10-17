import type { Metadata } from "next";
import { Brand } from "@/components/Logo";
import { SetPasswordForm } from "../SetPasswordForm";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <main className="simple-page" id="main">
      <div className="simple-card">
        <Brand href="/" />
        <h1>Choose a new password</h1>
        <p className="hint">You&apos;re signed in from the reset link. Pick a new password and you&apos;ll go straight to your library.</p>
        <SetPasswordForm then="home" label="Save and open my library" />
      </div>
    </main>
  );
}
