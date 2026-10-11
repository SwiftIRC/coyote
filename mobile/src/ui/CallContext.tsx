import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { RoomLink } from "../core/link";
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
  /** True from join() until the call ends, including the setup window before state exists. */
  busy: boolean;
  /** Leaves the live call (or cancels one still in setup); the Call screen then opens
   *  PreJoin for `link` instead of Home. Returns false (and does nothing) when there is
   *  no call to leave. */
  switchTo(link: RoomLink): boolean;
  takePendingLink(): RoomLink | null;
}

const Ctx = createContext<CallCtx | null>(null);
const NOTICE_MS = 4000;

export function CallProvider({ children }: { children: React.ReactNode }) {
  const active = useRef<{ call: Call; dispose(): void } | null>(null);
  const [state, setState] = useState<CallState | null>(null);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [joining, setJoining] = useState(false);
  const pending = useRef<RoomLink | null>(null);
  // The join still awaiting system-call setup (no call object yet). Leave or switch in
  // that window marks it cancelled, and the join stops once setup returns.
  const settingUp = useRef<{ cancelled: boolean } | null>(null);
  const [notices, setNotices] = useState<string[]>([]);

  const pushNotice = useCallback((text: string) => {
    setNotices((n) => [...n, text]);
    setTimeout(() => setNotices((n) => n.slice(1)), NOTICE_MS);
  }, []);

  // Clears the previous call's state and outcome synchronously (before the first
  // await) so a Call screen navigated to in the same tick never sees the old "ended".
  const join = useCallback(async (req: JoinRequest) => {
    active.current?.call.leave();
    pending.current = null;
    setJoining(true);
    setOutcome(null);
    setState(null);
    const setup = { cancelled: false };
    settingUp.current = setup;
    let failed = false;
    try {
      await setupSystemCalls();
    } catch (e) {
      console.warn("call setup failed", e);
      failed = true;
    }
    if (settingUp.current !== setup) return; // a newer join took over
    settingUp.current = null;
    if (setup.cancelled || failed) {
      // No call exists yet, so report it as an outcome; the Call screen acts on an
      // outcome with no live call (Home, PreJoin for a pending link, or PreJoin with
      // the setup error).
      setOutcome(setup.cancelled ? { kind: "left" } : { kind: "rejected", code: "setup", text: "Couldn't start the call." });
      setJoining(false);
      return;
    }
    // Events from a superseded call must not overwrite the current call's state.
    const made = createCall({
      change: (s) => {
        if (active.current === made) setState(s);
      },
      end: (o) => {
        made.dispose();
        if (active.current !== made) return;
        active.current = null;
        setOutcome(o);
      },
      notice: (text) => {
        if (active.current === made) pushNotice(text);
      },
    });
    active.current = made;
    try {
      await made.call.join(req);
    } catch (e) {
      // Ending the call fires end() -> dispose + outcome, so the Call screen leaves "connecting".
      console.warn("call join failed", e);
      made.call.leave();
      pushNotice("Couldn't join the call.");
    } finally {
      setJoining(false);
    }
  }, [pushNotice]);

  const leave = useCallback(() => {
    if (active.current) active.current.call.leave();
    else if (settingUp.current) settingUp.current.cancelled = true;
  }, []);
  const call = useCallback(() => active.current?.call ?? null, []);
  const switchTo = useCallback((link: RoomLink) => {
    if (active.current) {
      pending.current = link;
      active.current.call.leave();
      return true;
    }
    if (!settingUp.current) return false;
    pending.current = link;
    settingUp.current.cancelled = true;
    return true;
  }, []);
  const takePendingLink = useCallback(() => {
    const l = pending.current;
    pending.current = null;
    return l;
  }, []);
  useEffect(() => () => active.current?.call.leave(), []);

  const busy = joining || (!!state && state.phase !== "ended" && state.phase !== "idle");
  return <Ctx.Provider value={{ state, outcome, notices, join, leave, call, busy, switchTo, takePendingLink }}>{children}</Ctx.Provider>;
}

export function useCall(): CallCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCall outside CallProvider");
  return v;
}
