/** The message of the last failed request. */
export function ErrorBanner({ message }: { readonly message: string | null }) {
  if (message === null) return null;
  return (
    <div className="alert" role="alert">
      {message}
    </div>
  );
}
