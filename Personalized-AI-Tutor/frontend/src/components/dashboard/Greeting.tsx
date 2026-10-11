import { useEffect, useState } from "react";

const subtitles = [
  "Welcome back. Ready to keep learning?",
  "Let's pick up where you left off.",
  "Ready to make some progress today?",
  "What are we learning today?",
  "Let's get back to learning.",
];

export function getGreeting(name: string, d: Date) {
  const h = d.getHours();
  const title =
    h >= 5 && h < 12
      ? `Good morning, ${name} ☀️`
      : h >= 12 && h < 17
        ? `Good afternoon, ${name}`
        : h >= 17 && h < 23
          ? `Good evening, ${name} 🌙`
          : `Still studying, ${name}? 👀`;
  // Stable per day + time-of-day block, so refreshes don't reshuffle it.
  const dayIndex = Math.floor(d.getTime() / 86_400_000);
  const sub = subtitles[(dayIndex + Math.floor(h / 6)) % subtitles.length] ?? subtitles[0]!;
  return { title, sub };
}

export function Greeting({ name }: { name: string }) {
  const [g, setG] = useState<{ title: string; sub: string } | null>(null);
  useEffect(() => setG(getGreeting(name, new Date())), [name]);
  return (
    <div className="min-h-[88px]">
      {g && (
        <div className="fade-up">
          <h1 className="font-display text-4xl tracking-tight sm:text-5xl">{g.title}</h1>
          <p className="mt-2 text-muted-foreground">{g.sub}</p>
        </div>
      )}
    </div>
  );
}
