"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastAction = { label: string; onClick: () => void };
type ToastState = { msg: string; err?: boolean; action?: ToastAction } | null;
type ToastFn = (msg: string, opts?: { err?: boolean; action?: ToastAction; ms?: number }) => void;

const Ctx = createContext<ToastFn>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback<ToastFn>((msg, opts) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, err: opts?.err, action: opts?.action });
    timer.current = setTimeout(() => setToast(null), opts?.ms ?? (opts?.action ? 6000 : opts?.err ? 5000 : 2400));
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast${toast.err ? " err" : ""}`} role="status" aria-live="polite">
          <span>{toast.msg}</span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.onClick();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
