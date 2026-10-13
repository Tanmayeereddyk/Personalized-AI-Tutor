import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";

/**
 * Password input with an in-field show/hide toggle.
 *
 * The value stays fully controlled from outside (nothing is cleared when
 * toggling), the button is a real, labelled <button> for assistive tech, and
 * the field only ever mounts as a password input — text is revealed purely in
 * memory, never logged or stored anywhere.
 */
export function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  autoFocus,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        className="field"
        style={{ paddingRight: "2.75rem" }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}