import { useEffect, useRef, useState } from "react";
import {
  historyTarget,
  rememberLocation,
  type NavigationHistory,
  type WorkspaceLocation,
} from "./navigation";

export function useNavigationHistory(
  location: WorkspaceLocation,
  restore: (location: WorkspaceLocation) => void,
  valid: (location: WorkspaceLocation) => boolean,
) {
  const history = useRef<NavigationHistory>({ entries: [location], index: 0 });
  const [, update] = useState(0);
  const serialized = JSON.stringify(location);
  useEffect(() => {
    history.current = rememberLocation(history.current, JSON.parse(serialized));
    update((n) => n + 1);
  }, [serialized]);
  const back = historyTarget(history.current, -1, valid);
  const forward = historyTarget(history.current, 1, valid);
  return {
    canBack: back !== undefined,
    canForward: forward !== undefined,
    move(direction: -1 | 1) {
      const index = historyTarget(history.current, direction, valid);
      if (index === undefined) return;
      history.current = { ...history.current, index };
      restore(history.current.entries[index]);
      update((n) => n + 1);
    },
  };
}
