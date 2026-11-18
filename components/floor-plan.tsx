export function FloorPlan() {
  return (
    <svg
      className="plan-art"
      viewBox="0 0 460 330"
      role="img"
      aria-label="Illustrative two-bedroom courtyard floor plan"
    >
      <defs>
        <pattern
          id="timber"
          width="15"
          height="12"
          patternUnits="userSpaceOnUse"
        >
          <path d="M0 0h15" stroke="#d8d0bd" strokeWidth=".7" />
        </pattern>
      </defs>
      <g stroke="#515348" fill="none">
        <path d="M48 25h364v278H48z" fill="#f0eade" strokeWidth="6" />
        <path d="M49 26h362v276H49z" fill="url(#timber)" />
        <path d="M168 26v93h123V26" fill="#e2e6d4" strokeWidth="4" />
        <g fill="#aeb99a" stroke="#919a80">
          <circle cx="200" cy="60" r="18" />
          <circle cx="250" cy="79" r="24" />
          <circle cx="266" cy="54" r="12" />
        </g>
        <path d="M48 143h90m29 0V25m125 0v120h25m29 0h66" strokeWidth="5" />
        <g fill="#f9f6ef" strokeWidth="1.4">
          <rect x="64" y="44" width="80" height="77" />
          <rect x="69" y="47" width="31" height="14" rx="3" />
          <rect x="106" y="47" width="31" height="14" rx="3" />
          <path d="M64 68h80" />
          <rect x="308" y="43" width="85" height="80" />
          <rect x="312" y="47" width="34" height="14" rx="3" />
          <rect x="353" y="47" width="34" height="14" rx="3" />
          <path d="M308 69h85" />
        </g>
        <path d="M49 211h74v-67" strokeWidth="4" />
        <rect x="57" y="154" width="23" height="44" rx="5" />
        <path d="M409 153h-26v114h26z" fill="#e0d7c6" />
        <rect x="386" y="157" width="18" height="29" />
        <rect x="386" y="199" width="18" height="32" rx="4" />
        <g fill="#e6dfcf">
          <rect x="202" y="146" width="55" height="30" rx="5" />
          <path d="M206 143v-5h16v5m14 0v-5h16v5m-46 36v5h16v-5m14 0v5h16v-5" />
        </g>
        <path d="M103 246h86v31H83v-54h20z" fill="#ded8c8" />
        <path d="M104 251h80m-43 0v21" />
        <rect x="121" y="215" width="47" height="19" rx="9" fill="#d7c3aa" />
        <path
          d="M138 144v-29a29 29 0 0 1 29 29m151 0v-28a28 28 0 0 1 28 28"
          strokeWidth=".9"
        />
        <path
          d="M64 25h82m162 0h88M48 231v46m162 27h108m94-148v74"
          stroke="#a5b3ad"
          strokeWidth="4"
        />
      </g>
    </svg>
  );
}
