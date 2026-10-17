"use client";
import { startTransition, useActionState } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { PASSWORD_MIN } from "@/lib/auth-validate";
import { setPassword, type AuthState } from "../login/actions";
import { PasswordInput } from "../login/LoginForm";

export function SetPasswordForm({ then, label = "Save password" }: { then?: "home"; label?: string }) {
  const [state, run, pending] = useActionState<AuthState, FormData>(setPassword, {});
  return (
    <form
      className="set-pw"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => run(fd));
      }}
    >
      {then && <input type="hidden" name="then" value={then} />}
      <label className="field-label" htmlFor="password">
        New password
      </label>
      <PasswordInput id="password" name="password" auto="new-password" placeholder={`At least ${PASSWORD_MIN} characters, with a number`} />
      <label className="field-label" htmlFor="confirmPassword">
        Confirm new password
      </label>
      <PasswordInput id="confirmPassword" name="confirmPassword" auto="new-password" placeholder="Type it again" />
      <button className="btn" disabled={pending}>
        {pending ? <CircleNotch size={16} className="spin" /> : null} {label}
      </button>
      {state.error && (
        <div className="error-text" role="alert">
          {state.error}
        </div>
      )}
      {state.message && (
        <div className="notice" role="status" style={{ marginTop: 12 }}>
          {state.message}
        </div>
      )}
    </form>
  );
}
