import Link from "next/link";
export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Draft home">
      <svg
        viewBox="0 0 36 36"
        width="37"
        height="37"
        aria-hidden="true"
        fill="none"
      >
        <path
          d="M3 27 16 4l16 28H5l5-8h9l-3-6-4 7"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinejoin="miter"
        />
        <path d="m20 12 12 20" stroke="#fbf9f4" strokeWidth="2" />
      </svg>
      <span>Draft</span>
    </Link>
  );
}
