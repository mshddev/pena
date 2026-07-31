interface DocumentPageTitleProps {
  title: string;
}

export function DocumentPageTitle({ title }: DocumentPageTitleProps) {
  return (
    <header className="document-page-title">
      <h1>{title}</h1>
    </header>
  );
}
