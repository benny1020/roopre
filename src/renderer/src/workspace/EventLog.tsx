import { useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Pause } from "lucide-react";

type Event = { at: string; message: string };
const eventKey = (event: Event) => JSON.stringify([event.at, event.message]);

export default function EventLog({ events }: { events: Event[] }) {
  const root = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [unread, setUnread] = useState(false);
  const [trimmed, setTrimmed] = useState(false);
  const anchor = useRef<{ key: string; offset: number } | undefined>(undefined);
  const lastSeen = useRef("");
  const signature = JSON.stringify(events);
  const latest = events.length ? eventKey(events.at(-1)!) : "";
  const capture = () => {
    const container = root.current;
    if (!container) return;
    const top = container.getBoundingClientRect().top;
    const row = Array.from(
      container.querySelectorAll<HTMLElement>("[data-event]"),
    ).find((item) => item.getBoundingClientRect().bottom > top);
    anchor.current = row
      ? {
          key: row.dataset.event!,
          offset: row.getBoundingClientRect().top - top,
        }
      : undefined;
  };
  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    if (following) {
      container.scrollTop = container.scrollHeight;
      lastSeen.current = latest;
      setUnread(false);
      setTrimmed(false);
    } else {
      setUnread(latest !== lastSeen.current);
      if (anchor.current) {
        const row = Array.from(
          container.querySelectorAll<HTMLElement>("[data-event]"),
        ).find((item) => item.dataset.event === anchor.current!.key);
        if (row)
          container.scrollTop +=
            row.getBoundingClientRect().top -
            container.getBoundingClientRect().top -
            anchor.current.offset;
        else {
          container.scrollTop = 0;
          setTrimmed(true);
        }
      }
    }
  }, [signature, following, latest]);
  return (
    <div className="event-log-pane">
      <div className="log-controls">
        <span>
          {trimmed
            ? "Some earlier records are outside the retained history"
            : following
              ? "Following latest activity"
              : "Reading earlier activity"}
        </span>
        <button
          className="soft"
          aria-label={
            following ? "Pause log follow" : "Jump to latest activity"
          }
          onClick={() => {
            if (following) {
              capture();
              lastSeen.current = latest;
            }
            setFollowing(!following);
          }}
        >
          {following ? <Pause size={12} /> : <ArrowDown size={12} />}
          {following
            ? "Paused"
            : unread
              ? "New activity · Jump to latest"
              : "Jump to latest"}
        </button>
      </div>
      <div
        ref={root}
        className="output-scroll"
        tabIndex={0}
        aria-label="Activity log"
        onScroll={() => {
          const container = root.current!;
          const bottom =
            container.scrollHeight -
              container.clientHeight -
              container.scrollTop <=
            2;
          if (!bottom) {
            capture();
            if (following) {
              lastSeen.current = latest;
              setFollowing(false);
            }
          }
          // Resuming is explicit: layout changes must not steal a reader's viewport.
        }}
      >
        {events.length ? (
          <ol className="event-log">
            {events.map((event, index) => (
              <li
                key={`${eventKey(event)}:${index}`}
                data-event={eventKey(event)}
              >
                <time>{new Date(event.at).toLocaleTimeString()}</time>
                <span>{event.message}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="quiet-empty">Waiting for activity from the runner.</p>
        )}
      </div>
    </div>
  );
}
