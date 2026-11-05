// Re-mounted on every navigation (unlike the layout), so each page fades in softly.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
