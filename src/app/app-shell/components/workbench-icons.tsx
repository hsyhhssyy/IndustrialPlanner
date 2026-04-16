type WorkbenchIconKind =
  | "placement"
  | "delete"
  | "blueprint"
  | "history"
  | "toolbox"
  | "feedback"
  | "help"
  | "settings"
  | "panel-left"
  | "panel-right"
  | "pointer"
  | "cancel"
  | "confirm"
  | "rotate";

interface WorkbenchIconProps {
  kind: WorkbenchIconKind;
  className?: string;
}

export function WorkbenchIcon({
  kind,
  className,
}: WorkbenchIconProps) {
  if (kind === "placement") {
    return (
      <svg
        aria-hidden="true"
        className={className}
        focusable="false"
        viewBox="0 0 24 24"
      >
        <path d="M4 4H11V11H4V4ZM13 4H20V11H13V4ZM4 13H11V20H4V13ZM13 13H20V20H13V13Z" />
      </svg>
    );
  }

  if (kind === "delete") {
    return (
      <svg
        aria-hidden="true"
        className={className}
        focusable="false"
        viewBox="0 0 24 24"
      >
        <path d="M7 5H17L18 7H22V9H20V19C20 20.1 19.1 21 18 21H6C4.9 21 4 20.1 4 19V9H2V7H6L7 5ZM8 9V18H10V9H8ZM14 9V18H16V9H14Z" />
      </svg>
    );
  }

  if (kind === "blueprint") {
    return (
      <svg
        aria-hidden="true"
        className={className}
        focusable="false"
        viewBox="0 0 24 24"
      >
        <path d="M5 3H15L19 7V21H5V3ZM7 5V19H17V8H14V5H7ZM9 11H15V13H9V11ZM9 15H15V17H9V15Z" />
      </svg>
    );
  }

  if (kind === "history") {
    return (
      <svg
        aria-hidden="true"
        className={className}
        focusable="false"
        viewBox="0 0 24 24"
      >
        <path d="M13 3A9 9 0 1 0 21.9 13H19.9A7 7 0 1 1 13 5C16.1 5 18.8 7 19.7 9.8H17L21 13L25 9.8H21.8C20.8 5.9 17.2 3 13 3ZM12 8V13L16 15.3L17 13.6L14 11.9V8H12Z" />
      </svg>
    );
  }

  if (kind === "toolbox") {
    return (
      <svg
        aria-hidden="true"
        className={className}
        focusable="false"
        viewBox="0 0 24 24"
      >
        <path d="M9 4V6H15V4H18C19.1 4 20 4.9 20 6V9H4V6C4 4.9 4.9 4 6 4H9ZM4 11H10V12.5C10 13.3 10.7 14 11.5 14H12.5C13.3 14 14 13.3 14 12.5V11H20V18C20 19.1 19.1 20 18 20H6C4.9 20 4 19.1 4 18V11ZM12 11C11.4 11 11 11.4 11 12V12H13V12C13 11.4 12.6 11 12 11Z" />
      </svg>
    );
  }

  if (kind === "feedback") {
    return (
      <svg
        aria-hidden="true"
        className={className}
        focusable="false"
        viewBox="0 0 24 24"
      >
        <path d="M4 17.2V20H6.8L16.1 10.7L13.3 7.9L4 17.2ZM18.2 8.6C18.5 8.3 18.5 7.8 18.2 7.5L16.5 5.8C16.2 5.5 15.7 5.5 15.4 5.8L14.1 7.1L16.9 9.9L18.2 8.6ZM19 20H11V18H19V20Z" />
      </svg>
    );
  }

  if (kind === "help") {
    return (
      <svg
        aria-hidden="true"
        className={className}
        focusable="false"
        viewBox="0 0 24 24"
      >
        <path d="M12 2C6.5 2 2 6.5 2 12S6.5 22 12 22 22 17.5 22 12 17.5 2 12 2ZM12 18.2A1.2 1.2 0 1 1 12 15.8 1.2 1.2 0 0 1 12 18.2ZM13.2 13.2V14H10.8V12.6C10.8 11.9 11.1 11.2 11.7 10.8L12.9 9.9C13.4 9.5 13.7 9 13.7 8.4C13.7 7.3 12.8 6.5 11.7 6.5C10.6 6.5 9.7 7.3 9.7 8.4H7.3C7.3 6 9.3 4.1 11.7 4.1C14.2 4.1 16.1 6 16.1 8.4C16.1 9.8 15.5 11 14.3 11.8L13.4 12.4C13.3 12.5 13.2 12.8 13.2 13.2Z" />
      </svg>
    );
  }

  if (kind === "panel-left") {
    return (
      <svg
        aria-hidden="true"
        className={className}
        focusable="false"
        viewBox="0 0 24 24"
      >
        <path d="M4 5H20V19H4V5ZM6 7V17H10V7H6ZM12 7V17H18V7H12Z" />
      </svg>
    );
  }

  if (kind === "panel-right") {
    return (
      <svg
        aria-hidden="true"
        className={className}
        focusable="false"
        viewBox="0 0 24 24"
      >
        <path d="M4 5H20V19H4V5ZM6 7V17H12V7H6ZM14 7V17H18V7H14Z" />
      </svg>
    );
  }

  if (kind === "pointer") {
    return (
      <svg
        aria-hidden="true"
        className={className}
        focusable="false"
        viewBox="0 0 24 24"
      >
        <path d="M5 3L5 18L9.5 13.5L13 21L16.2 19.6L12.8 12.1L18.8 12.1L5 3Z" />
      </svg>
    );
  }

  if (kind === "cancel") {
    return (
      <svg
        aria-hidden="true"
        className={className}
        focusable="false"
        viewBox="0 0 24 24"
      >
        <path d="M7.41 6L12 10.59L16.59 6L18 7.41L13.41 12L18 16.59L16.59 18L12 13.41L7.41 18L6 16.59L10.59 12L6 7.41L7.41 6Z" />
      </svg>
    );
  }

  if (kind === "confirm") {
    return (
      <svg
        aria-hidden="true"
        className={className}
        focusable="false"
        viewBox="0 0 24 24"
      >
        <path d="M9.55 18.2L4.85 13.5L6.25 12.1L9.55 15.39L17.75 7.2L19.15 8.61L9.55 18.2Z" />
      </svg>
    );
  }

  if (kind === "rotate") {
    return (
      <svg
        aria-hidden="true"
        className={className}
        focusable="false"
        viewBox="0 0 24 24"
      >
        <path d="M12 5C15.87 5 19 8.13 19 12C19 15.87 15.87 19 12 19C8.9 19 6.27 16.98 5.35 14.18L3.44 14.81C4.63 18.42 8.01 21 12 21C16.97 21 21 16.97 21 12C21 7.03 16.97 3 12 3V0L7.5 4.5L12 9V5Z" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path
        clipRule="evenodd"
        d="M10.825 22Q10.35 22 9.963 21.725Q9.575 21.45 9.475 21L9.075 19.3Q8.8 19.2 8.538 19.05Q8.275 18.9 8.05 18.7L6.425 19.4Q5.975 19.6 5.513 19.488Q5.05 19.375 4.775 18.975L3.025 15.95Q2.75 15.55 2.75 15.088Q2.75 14.625 3.025 14.225L4.25 13.275Q4.2 13 4.175 12.725Q4.15 12.45 4.15 12.175Q4.15 11.9 4.175 11.625Q4.2 11.35 4.25 11.05L3.025 10.1Q2.625 9.8 2.525 9.35Q2.425 8.9 2.65 8.5L4.4 5.475Q4.675 5.075 5.138 4.962Q5.6 4.85 6.05 5.05L7.675 5.75Q7.9 5.55 8.162 5.4Q8.425 5.25 8.7 5.15L9.1 3.45Q9.2 3 9.588 2.725Q9.975 2.45 10.45 2.45H13.55Q14.025 2.45 14.413 2.725Q14.8 3 14.9 3.45L15.3 5.15Q15.575 5.25 15.837 5.4Q16.1 5.55 16.325 5.75L17.95 5.05Q18.4 4.85 18.862 4.962Q19.325 5.075 19.6 5.475L21.35 8.5Q21.575 8.9 21.475 9.35Q21.375 9.8 20.975 10.1L19.75 11.05Q19.8 11.35 19.825 11.625Q19.85 11.9 19.85 12.175Q19.85 12.45 19.825 12.725Q19.8 13 19.75 13.275L20.975 14.225Q21.375 14.525 21.475 14.987Q21.575 15.45 21.35 15.85L19.6 18.875Q19.325 19.275 18.862 19.388Q18.4 19.5 17.95 19.3L16.325 18.6Q16.1 18.8 15.837 18.95Q15.575 19.1 15.3 19.2L14.9 20.9Q14.8 21.35 14.413 21.625Q14.025 21.9 13.55 21.9H10.825ZM12 15.5Q13.45 15.5 14.475 14.475Q15.5 13.45 15.5 12Q15.5 10.55 14.475 9.525Q13.45 8.5 12 8.5Q10.55 8.5 9.525 9.525Q8.5 10.55 8.5 12Q8.5 13.45 9.525 14.475Q10.55 15.5 12 15.5ZM12 13.65Q11.317 13.65 10.833 13.167Q10.35 12.683 10.35 12Q10.35 11.317 10.833 10.833Q11.317 10.35 12 10.35Q12.683 10.35 13.167 10.833Q13.65 11.317 13.65 12Q13.65 12.683 13.167 13.167Q12.683 13.65 12 13.65Z"
        fillRule="evenodd"
      />
    </svg>
  );
}
