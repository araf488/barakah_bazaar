/** A form's refusal, announced as it appears, and the id the invalid fields point at. */
export function FormAlert({ id, message }: { id: string; message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <p
      id={id}
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
    >
      {message}
    </p>
  );
}
