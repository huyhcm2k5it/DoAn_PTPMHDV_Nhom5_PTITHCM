export function EmptyState({ title, description }: { title: string; description?: string }) {
  return <section className="state-card state-empty" aria-live="polite"><span className="state-icon" aria-hidden="true">✓</span><h2>{title}</h2>{description && <p>{description}</p>}</section>;
}