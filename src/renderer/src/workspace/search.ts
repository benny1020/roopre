// Prefer an exact title, then a title prefix, then words across title and context.
// Stable input order breaks ties, so live snapshots do not reshuffle equal matches.
export function searchCommands<T extends { title: string; meta: string }>(
  commands: T[],
  query: string,
): T[] {
  const text = query.trim().toLocaleLowerCase();
  if (!text) return commands;
  const words = text.split(/\s+/);
  return commands
    .map((command, index) => {
      const title = command.title.toLocaleLowerCase();
      const context = `${title} ${command.meta.toLocaleLowerCase()}`;
      const score = !words.every((word) => context.includes(word))
        ? -1
        : title === text
          ? 3
          : title.startsWith(text)
            ? 2
            : words.every((word) => title.includes(word))
              ? 1
              : 0;
      return { command, index, score };
    })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command);
}
