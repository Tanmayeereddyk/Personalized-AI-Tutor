import { useEffect, useRef, useState } from "react";

/**
 * Counts down to an absolute `deadline` (ms since the epoch).
 *
 * Why a deadline instead of a decrementing counter: the remaining time is
 * always derived from `Date.now()`, so normal re-renders and question
 * navigation never reset or restart the countdown. Pass `null` to disable the
 * timer entirely (the default for quizzes without a time limit).
 *
 * The interval is cleared whenever `deadline` changes or the component
 * unmounts, and again as soon as the countdown expires, so no timer leaks.
 */
export function useCountdown(deadline: number | null, onExpire: () => void): number {
  const [remainingMs, setRemainingMs] = useState(() =>
    deadline == null ? 0 : Math.max(0, deadline - Date.now()),
  );

  // Keep the latest callback in a ref so a new function identity on every
  // render can never re-create the interval (which would restart the timer).
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (deadline == null) {
      setRemainingMs(0);
      return;
    }

    let expired = false;
    const tick = (): void => {
      const left = deadline - Date.now();
      if (left <= 0) {
        expired = true;
        setRemainingMs(0);
        onExpireRef.current();
        return;
      }
      setRemainingMs(left);
    };

    // Handle the (edge) case where the deadline already passed on mount.
    tick();
    if (expired) return;

    const id = window.setInterval(() => {
      if (expired) return;
      tick();
      if (expired) window.clearInterval(id);
    }, 250);

    return () => window.clearInterval(id);
  }, [deadline]);

  return remainingMs;
}
