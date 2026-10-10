import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Call, CallOutcome, CallState, JoinRequest } from "../core/call";
import { createCall } from "../native/callFactory";
import { setupSystemCalls } from "../native/systemCall";

export interface CallCtx {
  state: CallState | null;
  outcome: CallOutcome | null;
  notices: string[];
  join(req: JoinRequest): Promise<void>;
  leave(): void;
  call(): Call | null;
}

const Ctx = createContext<CallCtx | null>(null);
const NOTICE_MS = 4000;

export function CallProvider({ children }: { children: React.ReactNode }) {
  const active = useRef<{ call: Call; dispose(): void } | null>(null);
  const [state, setState] = useState<CallState | null>(null);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [notices, setNotices] = useState<string[]>([]);

  const pushNotice = useCallback((text: string) => {
    setNotices((n) => [...n, text]);
    setTimeout(() => setNotices((n) => n.slice(1)), NOTICE_MS);
  }, []);

  // Clears the previous call's state and outcome synchronously (before the first
  // await) so a Call screen navigated to in the same tick never sees the old "ended".
  const join = useCallback(async (req: JoinRequest) => {
    active.current?.call.leave();
    setOutcome(null);
    setState(null);
    try {
      await setupSystemCalls();
    } catch (e) {
      // No call exists yet, so report the failure as an outcome; the Call screen acts
      // on an outcome with no live call and returns to PreJoin with this text.
      console.warn("call setup failed", e);
      setOutcome({ kind: "rejected", code: "setup", text: "Couldn't start the call." });
      return;
    }
    const made = createCall({
      change: (s) => setState(s),
      end: (o) => {
        setOutcome(o);
        made.dispose();
        if (active.current === made) active.current = null;
      },
      notice: pushNotice,
    });
    active.current = made;
    try {
      await made.call.join(req);
    } catch (e) {
      // Ending the call fires end() -> dispose + outcome, so the Call screen leaves "connecting".
      console.warn("call join failed", e);
      made.call.leave();
      pushNotice("Couldn't join the call.");
    }
  }, [pushNotice]);

  const leave = useCallback(() => active.current?.call.leave(), []);
  const call = useCallback(() => active.current?.call ?? null, []);
  useEffect(() => () => active.current?.call.leave(), []);

  return <Ctx.Provider value={{ state, outcome, notices, join, leave, call }}>{children}</Ctx.Provider>;
}

export function useCall(): CallCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCall outside CallProvider");
  return v;
}
