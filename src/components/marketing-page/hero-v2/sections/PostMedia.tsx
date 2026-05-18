import { Octopus } from "../../icons/octopus";

/* Shared "post media" used across all 5 platform mockup cards.
   The gradient image represents the underlying post (identical on every
   platform). The Octopus brand mark sits centered. Size scales down for
   mobile via the `small` prop. */
export interface PostMediaProps {
  small?: boolean;
}

export function PostMedia({ small = false }: PostMediaProps) {
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{
        background:
          "linear-gradient(135deg, #ff5a36 0%, #e88c5a 50%, #d9b88f 100%)",
      }}
      aria-hidden="true"
    >
      <Octopus size={small ? 36 : 70} color="#ffffff" />
    </div>
  );
}
