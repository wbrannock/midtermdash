import type { ReactNode } from "react";

export function Section({ title, lede, children, id, aside }: { title: string; lede?: ReactNode; children: ReactNode; id?: string; aside?: ReactNode }) {
  return (
    <section id={id} className="mt-12 first:mt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line-strong pb-2">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {aside ? <div className="text-xs text-fg-3">{aside}</div> : null}
      </div>
      {lede ? <p className="mt-2 max-w-prose text-sm text-fg-2">{lede}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-md border border-line bg-surface p-4 ${className}`}>{children}</div>;
}

export function Details({ summary, children, defaultOpen = false }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group border-t border-line py-2 first:border-t-0">
      <summary className="flex items-center gap-2 text-sm font-medium text-fg-2 hover:text-fg">
        <span className="chev text-fg-3" aria-hidden>
          ›
        </span>
        {summary}
      </summary>
      <div className="mt-2 pl-4 text-sm leading-relaxed text-fg-2">{children}</div>
    </details>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-line-strong p-4 text-sm text-fg-3">{children}</div>;
}
