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
            ? "이전 기록 일부가 보존 범위를 벗어났습니다"
            : following
              ? "최신 기록 따라가는 중"
              : "이전 기록 읽는 중"}
        </span>
        <button
          className="soft"
          aria-label={
            following ? "기록 자동 스크롤 일시정지" : "최신 기록으로 이동"
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
          {following ? "일시정지" : unread ? "새 기록 · 최신으로" : "최신으로"}
        </button>
      </div>
      <div
        ref={root}
        className="output-scroll"
        tabIndex={0}
        aria-label="진행 기록 로그"
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
          <p className="quiet-empty">실행기에서 진행 기록을 기다립니다.</p>
        )}
      </div>
    </div>
  );
}
